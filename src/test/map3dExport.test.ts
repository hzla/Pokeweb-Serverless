import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PNG } from "pngjs";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { Box3, Vector3 } from "three";
import { exportMap3dGlb } from "../pokeweb/map3dExport";
import { exportBuildingGlb } from "../pokeweb/buildingLibraryModel";
import type { Map3dPrimitive, Map3dSceneData } from "../pokeweb/map3dModel";

// Exercise the real exporter; provide only the browser image/file APIs it needs.
class TestImageData {
  constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
}
class TestCanvas {
  private image!: TestImageData;
  constructor(public width: number, public height: number) {}
  getContext() { return { putImageData: (image: TestImageData) => { this.image = image; } }; }
  async convertToBlob() {
    const png = new PNG({ width: this.width, height: this.height });
    png.data = Buffer.from(this.image.data);
    const bytes = PNG.sync.write(png);
    return new Blob([new Uint8Array(bytes)], { type: "image/png" });
  }
}
class TestFileReader {
  result?: ArrayBuffer;
  onloadend?: () => void;
  readAsArrayBuffer(blob: Blob) {
    void blob.arrayBuffer().then((bytes) => { this.result = bytes; this.onloadend?.(); });
  }
}

beforeEach(() => {
  vi.stubGlobal("ImageData", TestImageData);
  vi.stubGlobal("OffscreenCanvas", TestCanvas);
  vi.stubGlobal("FileReader", TestFileReader);
});
afterEach(() => vi.unstubAllGlobals());

function primitive(rgba?: number[]): Map3dPrimitive {
  return {
    material: {
      name: "tile", diffuse: [1, 1, 1], alpha: 1,
      texture: rgba ? { name: "shared-name", width: 2, height: 1, rgba: new Uint8Array(rgba) } : undefined,
    },
    positions: new Float32Array([0, 0, 0, 16, 0, 0, 0, 0, 16]),
    uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
    colors: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]),
    indices: new Uint16Array([0, 2, 1]),
  };
}

function mapData(primitives = [primitive()]): Map3dSceneData {
  return {
    zoneId: 7, label: "Test Town / Centre", season: "winter", matrixId: 8, sourceMatrixId: 2,
    areaId: 3, sourceAreaId: 4, textureId: 5, buildingsId: 6,
    areaMetadata: { buildingsId: 6, texturesId: 5, srtAnimeIdx: 0, patAnimeIdx: 0, isExterior: true },
    seasonal: true, chunkSpan: 512, chunkCount: 1, buildingCount: 1, textureCount: 1,
    entityCount: 0, npcModelCount: 0, permissionTileCount: 0,
    chunks: [{ chunkId: 9, sourceChunkId: 10, matrixX: 2, matrixY: 3, worldX: 1280, worldY: 32, worldZ: 1792, primitives }],
    buildings: [{ uid: 12, placementIndex: 0, modelId: 13, chunkId: 9, sourceChunkId: 10, worldX: 100, worldY: 20, worldZ: 200, rotationY: 90, primitives: [primitive()] }],
    entities: [{ kind: "warp", id: 1, x: 0, y: 0, z: 0, width: 16, height: 16, depth: 16, centered: false, label: "Do not export" }],
    npcModels: [], warnings: [],
  };
}

type GlbJson = {
  asset: { version: string };
  scenes: { extras: { pokeweb: { season: string; warnings: string[]; sourceOrigin: number[]; scaleFromSource: number; sourceUnitsPerTile: number } } }[];
  nodes: { name: string; translation?: number[]; rotation?: number[]; extras?: Record<string, number> }[];
  meshes: { primitives: { attributes: Record<string, number>; indices: number }[] }[];
  accessors: { bufferView: number; byteOffset?: number; count: number; componentType: number; type: string }[];
  bufferViews: { byteOffset?: number; byteLength: number; byteStride?: number }[];
  buffers: { uri?: string; byteLength: number }[];
  images: { bufferView: number; uri?: string; mimeType: string }[];
  textures: { source: number; sampler: number }[];
  samplers: { wrapS: number; wrapT: number; magFilter: number; minFilter: number }[];
  materials: { alphaMode?: string; alphaCutoff?: number; extensions: Record<string, unknown> }[];
};

function readGlb(bytes: ArrayBuffer) {
  const view = new DataView(bytes);
  expect(view.getUint32(0, true)).toBe(0x46546c67);
  expect(view.getUint32(4, true)).toBe(2);
  expect(view.getUint32(8, true)).toBe(bytes.byteLength);
  expect(view.getUint32(16, true)).toBe(0x4e4f534a);
  const jsonSize = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, jsonSize))) as GlbJson;
  expect(view.getUint32(24 + jsonSize, true)).toBe(0x004e4942);
  const bin = new Uint8Array(bytes, 28 + jsonSize);
  return { json, bin };
}

function readAccessor(glb: ReturnType<typeof readGlb>, id: number): number[] {
  const accessor = glb.json.accessors[id];
  const view = glb.json.bufferViews[accessor.bufferView];
  const data = new DataView(glb.bin.buffer, glb.bin.byteOffset);
  const components = { SCALAR: 1, VEC2: 2, VEC3: 3 }[accessor.type]!;
  const size = accessor.componentType === 5126 ? 4 : 2;
  return Array.from({ length: accessor.count * components }, (_, i) => {
    const offset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
      + Math.floor(i / components) * (view.byteStride ?? components * size) + (i % components) * size;
    return size === 4 ? data.getFloat32(offset, true) : data.getUint16(offset, true);
  });
}

describe("map Blender export", () => {
  it("exports terrain and rotated buildings in local tile units with reversible coordinates and source IDs", async () => {
    const data = mapData();
    const originalPositions = [...data.chunks[0].primitives[0].positions];
    const result = await exportMap3dGlb(data);
    const glb = readGlb(result.bytes);
    expect(result.filename).toBe("map-7-Test-Town-Centre-winter.glb");
    expect(result.chunkCount).toBe(1);
    expect(result.buildingCount).toBe(1);
    expect(glb.json.asset.version).toBe("2.0");
    expect(glb.json.scenes[0].extras.pokeweb.season).toBe("winter");
    const chunk = glb.json.nodes.find((node) => node.extras?.matrixX === 2)!;
    expect(chunk.translation).toEqual([36.375, 0.75, 49.75]);
    expect(chunk.extras?.sourceChunkId).toBe(10);
    const building = glb.json.nodes.find((node) => node.extras?.modelId === 13)!;
    expect(building.translation).toEqual([-37.375, 0, -49.75]);
    const metadata = glb.json.scenes[0].extras.pokeweb;
    expect(metadata.sourceOrigin).toEqual([698, 20, 996]);
    expect(metadata.scaleFromSource).toBe(1 / 16);
    expect(metadata.sourceUnitsPerTile).toBe(16);
    expect(chunk.translation!.map((value, i) => value / metadata.scaleFromSource + metadata.sourceOrigin[i])).toEqual([1280, 32, 1792]);
    expect(building.rotation![1]).toBeCloseTo(Math.SQRT1_2);
    expect(building.rotation![3]).toBeCloseTo(Math.SQRT1_2);
    expect(glb.json.nodes.some((node) => /NPC|warp|permission|Do not export/i.test(node.name))).toBe(false);
    const mesh = glb.json.meshes[0].primitives[0];
    expect(readAccessor(glb, mesh.attributes.POSITION)).toEqual(originalPositions.map((value) => value / 16));
    expect(readAccessor(glb, mesh.indices)).toEqual([0, 2, 1]);
    expect(readAccessor(glb, mesh.attributes.TEXCOORD_0)).toEqual([0, 0, 1, 0, 0, 1]);
    expect(readAccessor(glb, mesh.attributes.COLOR_0)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect([...data.chunks[0].primitives[0].positions]).toEqual(originalPositions);
    expect(data.chunks[0].worldX).toBe(1280);
    expect(data.buildings[0].worldZ).toBe(200);
  });

  it("keeps distant maps and all parent origins within a default viewport, without scaling shared geometry twice", async () => {
    const data = mapData();
    const shared = primitive();
    data.chunks[0].primitives = [shared];
    Object.assign(data.chunks[0], { worldX: 32000, worldY: -48, worldZ: -64000 });
    data.buildings[0].primitives = [shared];
    Object.assign(data.buildings[0], { worldX: 32032, worldY: -32, worldZ: -63968 });
    const result = await exportMap3dGlb(data);
    const loaded = await new GLTFLoader().parseAsync(result.bytes, "");
    const bounds = new Box3().setFromObject(loaded.scene, true);
    const center = bounds.getCenter(new Vector3());
    expect(center.x).toBeCloseTo(0);
    expect(center.z).toBeCloseTo(0);
    expect(bounds.min.y).toBeCloseTo(0);
    expect(bounds.getSize(new Vector3()).toArray()).toEqual([3, 1, 2]);
    loaded.scene.traverse((object) => {
      expect(object.getWorldPosition(new Vector3()).length()).toBeLessThan(5);
    });
    const glb = readGlb(result.bytes);
    expect(readAccessor(glb, glb.json.meshes[0].primitives[0].attributes.POSITION)).toEqual([0, 0, 0, 1, 0, 0, 0, 0, 1]);
    expect([...shared.positions]).toEqual([0, 0, 0, 16, 0, 0, 0, 0, 16]);
  });

  it("embeds PNGs, distinguishes same-name textures, deduplicates identical pixels, and preserves sampling and alpha", async () => {
    const opaque = [255, 0, 0, 255, 0, 255, 0, 255];
    const mask = [0, 0, 255, 255, 255, 255, 0, 0];
    const blend = [255, 0, 255, 128, 0, 255, 255, 255];
    const a = primitive(opaque);
    a.material.repeatS = true;
    a.material.flipS = true;
    a.material.repeatT = true;
    const b = primitive(mask);
    const c = primitive(blend);
    const duplicate = primitive(opaque);
    Object.assign(duplicate.material, { repeatS: true, flipS: true, repeatT: true });
    const data = mapData([a, b, c, duplicate]);
    data.buildings = [];
    const { json, bin } = readGlb((await exportMap3dGlb(data)).bytes);
    expect(json.images).toHaveLength(3);
    expect(json.textures).toHaveLength(3);
    expect(json.buffers[0].uri).toBeUndefined();
    for (const [index, pixels] of [opaque, mask, blend].entries()) {
      const image = json.images[index];
      expect(image.mimeType).toBe("image/png");
      expect(image.uri).toBeUndefined();
      const view = json.bufferViews[image.bufferView];
      const imageBytes = Buffer.from(bin.slice(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength));
      // GLTFExporter pads image buffer views to four-byte boundaries. PNGJS rejects that padding.
      let end = 8;
      while (end < imageBytes.length) {
        const chunkLength = imageBytes.readUInt32BE(end);
        const type = imageBytes.toString("ascii", end + 4, end + 8);
        end += chunkLength + 12;
        if (type === "IEND") break;
      }
      expect([...imageBytes.subarray(end)].every((byte) => byte === 0)).toBe(true);
      const png = PNG.sync.read(imageBytes.subarray(0, end));
      expect([png.width, png.height]).toEqual([2, 1]);
      expect([...png.data]).toEqual(pixels);
    }
    const sampler = json.samplers[json.textures[0].sampler];
    expect(sampler).toMatchObject({ wrapS: 33648, wrapT: 10497, magFilter: 9728, minFilter: 9728 });
    expect(json.materials.map((material) => material.alphaMode ?? "OPAQUE")).toEqual(["OPAQUE", "MASK", "BLEND", "OPAQUE"]);
    expect(json.materials[1].alphaCutoff).toBe(0.05);
    expect(json.materials.every((material) => "KHR_materials_unlit" in material.extensions)).toBe(true);
  });

  it("reports incomplete map assets in the result and GLB metadata", async () => {
    const data = mapData();
    data.warnings = ["Missing chunk 23"];
    data.buildingDiagnostics = [{ mapId: 9, placementIndex: 2, modelId: 88, status: "missing-model" }];
    const result = await exportMap3dGlb(data);
    expect(result.warnings).toHaveLength(2);
    expect(readGlb(result.bytes).json.scenes[0].extras.pokeweb.warnings).toEqual(result.warnings);
    expect(data.warnings).toEqual(["Missing chunk 23"]);
  });

  it("exports one library building with embedded textures and its bundle identity", async () => {
    const result = await exportBuildingGlb({
      id: "interior:5:2", kind: "interior", bundleId: 5, resourceIndex: 2, uid: 258, name: "test_house",
      modelBytes: new Uint8Array(), metadataBytes: new Uint8Array(), warnings: [], primitives: [primitive([255, 0, 0, 255, 0, 255, 0, 255])],
    });
    expect(result.filename).toBe("building-interior-bundle-5-uid-258-resource-2-test-house.glb");
    expect(result.chunkCount).toBe(0);
    expect(result.buildingCount).toBe(1);
    const { json } = readGlb(result.bytes);
    expect(json.images).toHaveLength(1);
    expect(json.scenes[0].extras.pokeweb).toMatchObject({ content: "Static building model", bundleKind: "interior", bundleId: 5, uid: 258, resourceIndex: 2 });
    expect(json.scenes[0].extras.pokeweb).not.toHaveProperty("zoneId");
    expect(json.meshes).toHaveLength(1);
  });

  it("rejects an empty map instead of downloading an empty file", async () => {
    const data = mapData([]);
    data.buildings = [];
    await expect(exportMap3dGlb(data)).rejects.toThrow("no terrain or buildings");
  });
});
