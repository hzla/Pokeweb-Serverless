import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PNG } from "pngjs";
import { concatBytes, writeU32 } from "../nds/binary";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { exportModifiedRom } from "../pokeweb/exportRom";
import { loadProjectFromRomBytes } from "../pokeweb/loader";
import { extractGameFreakContainer, loadMap3dZone, type Map3dSceneData } from "../pokeweb/map3dModel";
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
  it("rejects conflicting shared mesh edits and missing terrain before changing project state", async () => {
    const { project, data } = await setup(), file = unpack(exported);
    const houses = roots(file, "building").filter((i: number) => file.json.nodes[i].extras.uid === 305);
    alterGeometry(file, houses[0]);
    alterGeometry(file, houses[1]); childMesh(file, houses[1]).translation[1] = 0.5;
    await expect(prepareMapGlbImport(project, data, pack(file))).rejects.toThrow(/conflicting mesh edits/);
    const missing = unpack(exported); removeNode(missing, roots(missing, "terrain")[0]);
    await expect(prepareMapGlbImport(project, data, pack(missing))).rejects.toThrow(/exactly one parent/);
    expect(project.narcs.maps!.dirty.size).toBe(0);
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
