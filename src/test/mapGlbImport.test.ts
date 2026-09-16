import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PNG } from "pngjs";
import { readU16, concatBytes, writeU32 } from "../nds/binary";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { exportModifiedRom } from "../pokeweb/exportRom";
import { loadProjectFromRomBytes } from "../pokeweb/loader";
import { extractGameFreakContainer, loadMap3dZone, type Map3dSceneData } from "../pokeweb/map3dModel";
import { materialRecords } from "../pokeweb/nitroResourceWriter";
import { loadBuildingLibrary } from "../pokeweb/buildingLibraryModel";
import { applyMapGlbImport, exportMapGlbForImport, prepareMapGlbImport } from "../pokeweb/mapGlbImport";
import { compileStaticFaces } from "../pokeweb/nitroGeometryFaces";
import { sameStaticGeometry } from "../pokeweb/staticMeshCompare";
import type { StaticModelMesh } from "../pokeweb/nitroModelWriter";
import type { ProjectState } from "../pokeweb/projectStore";

const sameBytes = (a: Uint8Array, b: Uint8Array) => Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength));

function square(): StaticModelMesh {
  return { materialName: "test", positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
    indices: new Uint16Array([0, 1, 2, 0, 2, 3]), uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]) };
}
describe("native geometry comparison and quad reconstruction", () => {
  it("ignores vertex splitting, triangle order and cyclic vertex order, while retaining winding and UV changes", () => {
    const mesh = square();
    const reordered = { ...mesh, indices: new Uint16Array([2, 3, 0, 1, 2, 0]) };
    expect(sameStaticGeometry([mesh], [reordered])).toBe(true);
    expect(sameStaticGeometry([mesh], [{ ...mesh, indices: new Uint16Array([0, 2, 1, 0, 2, 3]) }])).toBe(false);
    const uvs = mesh.uvs!.slice(); uvs[0] += 0.25;
    expect(sameStaticGeometry([mesh], [{ ...mesh, uvs }])).toBe(false);
    const colored = { ...mesh, colors: new Float32Array(12).fill(0.5) };
    expect(sameStaticGeometry([mesh], [colored])).toBe(false);
  });
  it("reconstructs a planar quad without merging a bent surface or mismatched attributes", () => {
    const mesh = square();
    expect(compileStaticFaces([mesh]).map(f => f.length)).toEqual([4]);
    const bent = mesh.positions.slice(); bent[11] = 1;
    expect(compileStaticFaces([{ ...mesh, positions: bent }]).map(f => f.length)).toEqual([3, 3]);
    const first = { ...mesh, indices: mesh.indices.slice(0, 3) };
    const second = { ...mesh, indices: mesh.indices.slice(3), colors: new Float32Array(12).fill(0.5) };
    expect(compileStaticFaces([first, second]).map(f => f.length)).toEqual([3, 3]);
  });
  it("ignores Blender normal changes only on zero-area faces", () => {
    const mesh = { ...square(), normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]) };
    const normals = new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]);
    expect(sameStaticGeometry([mesh], [{ ...mesh, normals }])).toBe(false);
    mesh.indices = new Uint16Array([0, 0, 1]);
    expect(sameStaticGeometry([mesh], [{ ...mesh, normals }])).toBe(true);
  });
});

function unpack(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), length = view.getUint32(12, true);
  return { json: JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length))), binary: bytes.slice(28 + length) };
}
function pack({ json, binary }: ReturnType<typeof unpack>) {
  const encoded = new TextEncoder().encode(JSON.stringify(json)), length = (encoded.length + 3) & ~3;
  const out = new Uint8Array(28 + length + binary.length);
  writeU32(out, 0, 0x46546c67); writeU32(out, 4, 2); writeU32(out, 8, out.length);
  writeU32(out, 12, length); writeU32(out, 16, 0x4e4f534a); out.fill(32, 20, 20 + length); out.set(encoded, 20);
  writeU32(out, 20 + length, binary.length); writeU32(out, 24 + length, 0x004e4942); out.set(binary, 28 + length);
  return out;
}
function roots(file: ReturnType<typeof unpack>, kind: string) {
  return file.json.nodes.flatMap((n: any, i: number) => n.extras?.pokewebMapObject?.startsWith(kind + ":") ? [i] : []);
}
function childMesh(file: ReturnType<typeof unpack>, parent: number): any {
  const node = file.json.nodes[parent];
  return node.mesh === undefined ? childMesh(file, node.children[0]) : node;
}
function alterGeometry(file: ReturnType<typeof unpack>, parent: number) {
  const mesh = childMesh(file, parent);
  // Child transforms are valid mesh edits and do not alter shared GLB buffer accessors.
  mesh.translation = [0, 0.25, 0];
}
function removeNode(file: ReturnType<typeof unpack>, id: number) {
  for (const node of file.json.nodes) if (node.children) node.children = node.children.filter((i: number) => i !== id);
}
function duplicateNode(file: ReturnType<typeof unpack>, id: number): number {
  const node = structuredClone(file.json.nodes[id]);
  if (node.children) node.children = node.children.map((child: number) => duplicateNode(file, child));
  const copy = file.json.nodes.length; file.json.nodes.push(node); return copy;
}
function addDuplicate(file: ReturnType<typeof unpack>, id: number, offset = 2): number {
  const copy = duplicateNode(file, id);
  file.json.nodes[copy].translation[0] += offset;
  const owner = file.json.nodes.find((n: any) => n.children?.includes(id)); owner.children.push(copy);
  return copy;
}

class TestImageData { constructor(public data: Uint8ClampedArray, public width: number, public height: number) {} }
class TestCanvas {
  image!: TestImageData;
  constructor(public width: number, public height: number) {}
  getContext() { return { putImageData: (image: TestImageData) => { this.image = image; } }; }
  async convertToBlob() { const png = new PNG({ width: this.width, height: this.height }); png.data = Buffer.from(this.image.data); return new Blob([new Uint8Array(PNG.sync.write(png))], { type: "image/png" }); }
}
class TestFileReader {
  result?: ArrayBuffer; onloadend?: () => void;
  readAsArrayBuffer(blob: Blob) { void blob.arrayBuffer().then(bytes => { this.result = bytes; this.onloadend?.(); }); }
}

const romPath = resolve(process.cwd(), "../cleanwhite2.nds");
describe.skipIf(!existsSync(romPath))("BW2 full map GLB import", () => {
  let original: Uint8Array, exported: Uint8Array;
  async function setup(): Promise<{ project: ProjectState; data: Map3dSceneData }> {
    const project = await loadProjectFromRomBytes(original, "cleanwhite2.nds", { selectedNarcs: ["maps"] });
    return { project, data: await loadMap3dZone(project, 427, { season: "winter" }) };
  }
  beforeAll(async () => {
    vi.stubGlobal("ImageData", TestImageData); vi.stubGlobal("OffscreenCanvas", TestCanvas); vi.stubGlobal("FileReader", TestFileReader);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    original = new Uint8Array(readFileSync(romPath));
    const { project, data } = await setup();
    exported = new Uint8Array((await exportMapGlbForImport(project, data)).bytes);
  }, 30000);
  afterAll(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  it("keeps all native resources byte-identical for an unchanged map", async () => {
    const { project, data } = await setup();
    const result = await prepareMapGlbImport(project, data, exported);
    expect(result.patches).toHaveLength(0);
    expect(project.narcs.maps!.dirty.size).toBe(0);
    expect(project.narcs.exterior_building_models).toBeUndefined();
  });
  it("imports White Forest after removing animated leaves while preserving their unused native material records", async () => {
    const { project } = await setup(), data = await loadMap3dZone(project, 424, { season: "spring" });
    const bytes = new Uint8Array((await exportMapGlbForImport(project, data)).bytes);
    expect((await prepareMapGlbImport(project, data, bytes)).patches).toHaveLength(0);
    const file = unpack(bytes);
    function removeLeaves(id: number) {
      const node = file.json.nodes[id];
      if (node.mesh !== undefined) {
        const mesh = file.json.meshes[node.mesh];
        mesh.primitives = mesh.primitives.filter((p: any) => file.json.materials[p.material].extras?.pokewebNativeMaterial !== "bc_ha01");
        if (!mesh.primitives.length) delete node.mesh;
      }
      node.children?.forEach(removeLeaves);
    }
    roots(file, "terrain").forEach(removeLeaves);
    const result = await prepareMapGlbImport(project, data, pack(file));
    expect([result.terrainModels, result.buildingModels, result.importedTextures]).toEqual([1, 0, 0]);
    expect(result.patches.map(p => p.index)).toEqual([366]);
    for (const patch of result.patches) {
      expect(patch.archive.name).toBe("maps");
      const before = extractGameFreakContainer(patch.bytes).files, after = extractGameFreakContainer(patch.after).files;
      expect(materialRecords(after[0])).toEqual(materialRecords(before[0]));
      expect(after.slice(1)).toEqual(before.slice(1)); // Collision, placements and other members.
    }
    for (const chunk of result.converted.chunks) {
      expect(chunk.primitives.some(p => p.material.name === "bc_ha01")).toBe(false);
      const expected = data.chunks.find(c => c.chunkId === chunk.chunkId)!.primitives.filter(p => p.material.name !== "bc_ha01");
      expect(sameStaticGeometry(expected.map(p => ({ ...p, materialName: p.material.name })), chunk.primitives.map(p => ({ ...p, materialName: p.material.name })))).toBe(true);
    }
    expect(project.narcs.maps!.dirty.size).toBe(0);
  });
  it("imports interior terrain while retaining its interior building bundle", async () => {
    const { project } = await setup();
    const data = await loadMap3dZone(project, 428, { season: "winter" });
    expect(data.areaMetadata.isExterior).toBe(false);
    const file = unpack(new Uint8Array((await exportMapGlbForImport(project, data)).bytes));
    alterGeometry(file, roots(file, "terrain")[0]);
    const result = await prepareMapGlbImport(project, data, pack(file));
    expect([result.terrainModels, result.buildingModels, result.moved]).toEqual([1, 0, 0]);
    expect(result.converted.buildings.length).toBe(data.buildings.length);
    expect(result.converted.areaMetadata.isExterior).toBe(false);
  });
  it("stages terrain, shared building geometry, movement, additions and deletions atomically; exports, reloads and undoes them", async () => {
    const { project, data } = await setup(), file = unpack(exported);
    // This chunk has over 2,048 triangles; native quad reconstruction is required.
    const terrain = roots(file, "terrain").find((i: number) => file.json.nodes[i].extras.chunkId === 280)!;
    alterGeometry(file, terrain);
    const houses = roots(file, "building").filter((i: number) => file.json.nodes[i].extras.uid === 305);
    alterGeometry(file, houses[0]);
    file.json.nodes[houses[0]].translation[0] += 1;
    addDuplicate(file, houses[0]);
    removeNode(file, houses[2]);
    const before = project.narcs.maps!.rawFiles.slice();
    const result = await prepareMapGlbImport(project, data, pack(file));
    expect([result.terrainModels, result.buildingModels, result.moved, result.added, result.deleted]).toEqual([1, 1, 1, 1, 1]);
    expect(project.narcs.maps!.rawFiles.every((file, i) => file === before[i])).toBe(true);
    expect(project.narcs.maps!.dirty.size).toBe(0);
    expect(result.converted.buildings.length).toBe(data.buildings.length);
    await applyMapGlbImport(project, result);
    const romBytes = await exportModifiedRom(project);
    const savedRom = new NintendoDSRom(romBytes);
    const native = new NARC(savedRom.getFileByName("a/0/0/8"));
    for (const c of data.chunks) {
      const a = extractGameFreakContainer(before[c.chunkId]).files, b = extractGameFreakContainer(native.files[c.chunkId]).files;
      expect(sameBytes(b[1], a[1])).toBe(true); // collision and walking heights
      for (let i = 3; i < a.length; i++) expect(sameBytes(b[i], a[i])).toBe(true);
    }
    const reload = await loadProjectFromRomBytes(romBytes, "edited.nds", { selectedNarcs: ["maps"] });
    const preview = await loadMap3dZone(reload, 427, { season: "winter" });
    expect(preview.buildings.map(b => [b.uid, b.worldX, b.worldY, b.worldZ])).toEqual(result.converted.buildings.map(b => [b.uid, b.worldX, b.worldY, b.worldZ]));
    for (const patch of result.patches) expect(sameBytes(new NARC(savedRom.getFileByName(patch.archive.path)).files[patch.index], patch.after)).toBe(true);
    await expect(applyMapGlbImport(project, result)).rejects.toThrow(/changed during review/);
    await applyMapGlbImport(project, result, true);
    for (const c of data.chunks) expect(sameBytes(project.narcs.maps!.rawFiles[c.chunkId], before[c.chunkId])).toBe(true);
  }, 30000);
  it("moves a placement across chunk boundaries using native destination coordinates", async () => {
    const { project, data } = await setup(), file = unpack(exported);
    const house = roots(file, "building").find((i: number) => file.json.nodes[i].extras.uid === 305)!;
    const original = file.json.nodes[house], destination = data.chunks.find(c => c.chunkId !== original.extras.chunkId)!;
    const origin = file.json.scenes[0].extras.pokeweb.sourceOrigin;
    original.translation[0] = (destination.worldX - origin[0]) / 16;
    original.translation[2] = (destination.worldZ - origin[2]) / 16;
    const result = await prepareMapGlbImport(project, data, pack(file));
    expect([result.moved, result.added, result.deleted, result.buildingModels]).toEqual([1, 0, 0, 0]);
    expect(result.converted.buildings.some(b => b.uid === 305 && b.chunkId === destination.chunkId && b.worldX === destination.worldX && b.worldZ === destination.worldZ)).toBe(true);
  });
  it("creates variants for conflicting shared mesh edits and rejects missing terrain before changing project state", async () => {
    const { project, data } = await setup(), file = unpack(exported);
    const houses = roots(file, "building").filter((i: number) => file.json.nodes[i].extras.uid === 305);
    alterGeometry(file, houses[0]);
    alterGeometry(file, houses[1]); childMesh(file, houses[1]).translation[1] = 0.5;
    const variants = await prepareMapGlbImport(project, data, pack(file));
    expect(variants.buildingVariants).toBe(1);
    expect(variants.buildingModels).toBe(2);
    expect(variants.converted.buildings.some(b => b.uid === 511)).toBe(true);
    expect(project.narcs.exterior_building_models).toBeUndefined();
    const missing = unpack(exported); removeNode(missing, roots(missing, "terrain")[0]);
    await expect(prepareMapGlbImport(project, data, pack(missing))).rejects.toThrow(/exactly one parent/);
    expect(project.narcs.maps!.dirty.size).toBe(0);
  });
  it("imports a new emissive material and color texture, guards its archive, and undoes the native assets", async () => {
    const { project, data } = await setup(), file = unpack(exported);
    const house = roots(file, "building").find((i: number) => file.json.nodes[i].extras.uid === 305)!;
    const node = childMesh(file, house), originalMesh = file.json.meshes[node.mesh];
    const materialId = originalMesh.primitives[0].material, oldMaterial = file.json.materials[materialId];
    const material = structuredClone(oldMaterial);
    material.name = "New neon sign"; delete material.extras; delete material.extensions;
    material.emissiveFactor = [0.3, 1, 0.5]; material.emissiveTexture = material.pbrMetallicRoughness.baseColorTexture;
    material.pbrMetallicRoughness = { baseColorFactor: [0, 0, 0, 1] };
    const addedMaterial = file.json.materials.length; file.json.materials.push(material);
    const mesh = structuredClone(originalMesh); mesh.primitives[0].material = addedMaterial;
    node.mesh = file.json.meshes.length; file.json.meshes.push(mesh);
    const result = await prepareMapGlbImport(project, data, pack(file));
    expect(result.importedTextures).toBe(1); expect(result.buildingModels).toBe(1);
    const textures = result.patches.find(p => p.archive.name === "exterior_building_textures")!;
    expect(textures).toBeDefined();
    await applyMapGlbImport(project, result);
    const asset = (await loadBuildingLibrary(project)).load("exterior:52:29");
    const added = materialRecords(asset.modelBytes).find(m => m.name.startsWith("pw_m"))!;
    expect(added.textureName).toMatch(/^pw_t/); expect(readU16(added.bytes, 30) & 0x20).toBe(0); // never wireframe
    expect(asset.primitives.find(p => p.material.name === added.name)?.material.texture).toBeDefined();
    await applyMapGlbImport(project, result, true);
    expect(project.narcs.exterior_building_textures!.rawFiles[textures.index]).toEqual(textures.bytes);
    project.narcs.exterior_building_textures!.rawFiles[textures.index] = concatBytes([textures.bytes, Uint8Array.of(1)]);
    await expect(applyMapGlbImport(project, result)).rejects.toThrow(/changed during review/);
  });
  it("previews terrain texture edits from the staged archive before applying them", async () => {
    const { project, data } = await setup(), file = unpack(exported);
    const node = childMesh(file, roots(file, "terrain")[0]), primitive = file.json.meshes[node.mesh].primitives[0];
    file.json.materials[primitive.material].pbrMetallicRoughness.baseColorFactor = [0.25, 1, 0.5, 1];
    const result = await prepareMapGlbImport(project, data, pack(file));
    expect(result.patches.some(p => p.archive.name === "map_textures")).toBe(true);
    const changed = result.converted.chunks.flatMap(c => c.primitives).filter(p => p.material.texture?.name.startsWith("pw_t"));
    expect(changed.length).toBeGreaterThan(0);
    expect(project.narcs.map_textures).toBeUndefined();
  });
  it("rejects old exports, the wrong season, stale resources, and edits made after review", async () => {
    const { project, data } = await setup(), file = unpack(exported);
    delete file.json.scenes[0].extras.pokeweb.mapImport;
    await expect(prepareMapGlbImport(project, data, pack(file))).rejects.toThrow(/Export this full map again/);
    await expect(prepareMapGlbImport(project, { ...data, season: "spring" }, exported)).rejects.toThrow(/same map and season/);
    const edit = unpack(exported), house = roots(edit, "building")[0];
    edit.json.nodes[house].translation[0] += 1;
    const staged = await prepareMapGlbImport(project, data, pack(edit));
    const id = data.chunks[0].chunkId;
    project.narcs.maps!.rawFiles[id] = concatBytes([project.narcs.maps!.rawFiles[id], Uint8Array.of(99)]);
    await expect(applyMapGlbImport(project, staged)).rejects.toThrow(/changed during review/);
    await expect(prepareMapGlbImport(project, data, exported)).rejects.toThrow(/changed since/);
    expect(project.narcs.maps!.dirty.size).toBe(0);
  });
  it("rejects placement overflow and unbound meshes", async () => {
    const { project, data } = await setup(), file = unpack(exported);
    const house = roots(file, "building").find((i: number) => file.json.nodes[i].extras.uid === 305)!;
    for (let i = 0; i < 32; i++) addDuplicate(file, house, 0);
    await expect(prepareMapGlbImport(project, data, pack(file))).rejects.toThrow(/building slots/);
    const unbound = unpack(exported), child = duplicateNode(unbound, unbound.json.nodes[roots(unbound, "terrain")[0]].children[0]);
    unbound.json.scenes[0].nodes.push(child);
    await expect(prepareMapGlbImport(project, data, pack(unbound))).rejects.toThrow(/no map resource parent/);
  });
});

const blackRomPath = resolve(process.cwd(), "../cleanblack2.nds");
describe.skipIf(!existsSync(blackRomPath))("Black City material animations", () => {
  it("retains repeated facade UVs and warns if an edited GLB instead clamps their edges", async () => {
    vi.stubGlobal("ImageData", TestImageData); vi.stubGlobal("OffscreenCanvas", TestCanvas); vi.stubGlobal("FileReader", TestFileReader);
    const quiet = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const project = await loadProjectFromRomBytes(new Uint8Array(readFileSync(blackRomPath)), "cleanblack2.nds", { selectedNarcs: ["maps"] });
      const data = await loadMap3dZone(project, 0, { season: "spring" });
      const file = unpack(new Uint8Array((await exportMapGlbForImport(project, data)).bytes));
      const parent = roots(file, "building").find((i: number) => file.json.nodes[i].extras.uid === 414)!;
      const facadePrimitive = file.json.nodes[parent].children
        .flatMap((i: number) => file.json.meshes[file.json.nodes[i].mesh]?.primitives ?? [])
        .find((p: any) => file.json.materials[p.material].extras?.pokewebNativeMaterial === "bc_build_a");
      const material = file.json.materials[facadePrimitive.material];
      material.pbrMetallicRoughness.baseColorFactor = [0.25, 1, 0.5, 1];
      const texture = file.json.textures[material.pbrMetallicRoughness.baseColorTexture.index];
      const sampler = file.json.samplers[texture.sampler];
      Object.assign(sampler, { wrapS: 33071, wrapT: 33071 });
      const clamped = await prepareMapGlbImport(project, data, pack(file));
      expect(clamped.notes.some(n => n.includes("bc_build_a") && n.includes("Clamp to Edge"))).toBe(true);
      Object.assign(sampler, { wrapS: 10497, wrapT: 10497 });
      const repeated = await prepareMapGlbImport(project, data, pack(file));
      expect(repeated.notes.some(n => n.includes("Clamp to Edge"))).toBe(false);
      const facade = repeated.converted.buildings.find(b => b.uid === 414)!.primitives.find(p => p.material.name === "bc_build_a")!;
      expect([facade.material.repeatS, facade.material.repeatT]).toEqual([true, true]);
      expect(facade.material.texture?.name).toMatch(/^pw_t/);
      expect(facade.uvs!.some(v => v < 0 || v > 1)).toBe(true);
      await applyMapGlbImport(project, repeated);
      const asset = (await loadBuildingLibrary(project)).entries.find(e => e.kind === "exterior" && e.bundleId === data.buildingsId && e.uid === 414)!;
      const native = materialRecords(asset.modelBytes).find(m => m.name === "bc_build_a")!;
      expect(new DataView(native.bytes.buffer, native.bytes.byteOffset).getUint32(20, true) & 0x30000).toBe(0x30000);
    } finally { vi.unstubAllGlobals(); quiet.mockRestore(); }
  }, 30000);
  it("preserves material animation blobs when building geometry is edited", async () => {
    vi.stubGlobal("ImageData", TestImageData); vi.stubGlobal("OffscreenCanvas", TestCanvas); vi.stubGlobal("FileReader", TestFileReader);
    const quiet = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const project = await loadProjectFromRomBytes(new Uint8Array(readFileSync(blackRomPath)), "cleanblack2.nds", { selectedNarcs: ["maps"] });
      const data = await loadMap3dZone(project, 0, { season: "spring" });
      const file = unpack(new Uint8Array((await exportMapGlbForImport(project, data)).bytes));
      const baseline = (await loadBuildingLibrary(project)).entries.filter(e => e.bundleId === data.buildingsId && e.kind === "exterior");
      const parent = roots(file, "building").find((i: number) => file.json.nodes[i].extras.uid === 414)!;
      alterGeometry(file, parent);
      const result = await prepareMapGlbImport(project, data, pack(file));
      expect(result.buildingModels).toBe(1);
      await applyMapGlbImport(project, result);
      const after = (await loadBuildingLibrary(project)).entries.filter(e => e.bundleId === data.buildingsId && e.kind === "exterior");
      for (const entry of baseline) expect(after.find(e => e.uid === entry.uid)?.metadataBytes).toEqual(entry.metadataBytes);
    } finally { vi.unstubAllGlobals(); quiet.mockRestore(); }
  }, 30000);
});
