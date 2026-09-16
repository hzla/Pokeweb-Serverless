import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { concatBytes, readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { modelAssetHash, readBuildingGlb } from "../pokeweb/buildingGlb";
import { applyBuildingImport, prepareBuildingImport, replaceBuildingModelMember } from "../pokeweb/buildingImportModel";
import { loadBuildingLibrary, type BuildingLibraryAsset } from "../pokeweb/buildingLibraryModel";
import { exportModifiedRom } from "../pokeweb/exportRom";
import { loadProjectFromRomBytes } from "../pokeweb/loader";
import { buildModelPrimitives, extractGameFreakContainer, loadMap3dZone, packGameFreakContainer, readNitroResources } from "../pokeweb/map3dModel";
import { writeStaticNitroModel } from "../pokeweb/nitroModelWriter";
import { materialRecords, replaceMaterialRecords } from "../pokeweb/nitroResourceWriter";
import { sameStaticGeometry } from "../pokeweb/staticMeshCompare";

function glb(document: any, binary: Uint8Array) {
  const json = new TextEncoder().encode(JSON.stringify(document));
  const jsonLength = (json.length + 3) & ~3, binLength = (binary.length + 3) & ~3;
  const bytes = new Uint8Array(28 + jsonLength + binLength);
  writeU32(bytes, 0, 0x46546c67); writeU32(bytes, 4, 2); writeU32(bytes, 8, bytes.length);
  writeU32(bytes, 12, jsonLength); writeU32(bytes, 16, 0x4e4f534a);
  bytes.fill(32, 20, 20 + jsonLength); bytes.set(json, 20);
  writeU32(bytes, 20 + jsonLength, binLength); writeU32(bytes, 24 + jsonLength, 0x004e4942); bytes.set(binary, 28 + jsonLength);
  return bytes;
}

function simpleGlb() {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const document: any = { asset: { version: "2.0" }, buffers: [{ byteLength: positions.byteLength }],
    bufferViews: [{ buffer: 0, byteLength: positions.byteLength }], accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3" }],
    materials: [{ name: "wall" }], meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
    nodes: [{ translation: [1, 2, 3], children: [1] }, { mesh: 0 }], scene: 0,
    scenes: [{ nodes: [0], extras: { pokeweb: { buildingImportVersion: 1, content: "Static building model", scaleFromSource: 1 / 16, sourceOrigin: [10, 20, 30] } } }],
  };
  return { document, binary: new Uint8Array(positions.buffer) };
}

describe("building GLB boundary", () => {
  it("resolves parent transforms and restores the native origin and tile scale", () => {
    const { document, binary } = simpleGlb();
    const result = readBuildingGlb(glb(document, binary));
    expect([...result.meshes[0].positions]).toEqual([26, 52, 78, 42, 52, 78, 26, 68, 78]);
    expect([...result.meshes[0].indices]).toEqual([0, 1, 2]);
  });
  it("keeps the triangle facing direction when baking a mirrored object", () => {
    const { document, binary } = simpleGlb(); document.nodes[1].scale = [-1, 1, 1];
    expect([...readBuildingGlb(glb(document, binary)).meshes[0].indices]).toEqual([0, 2, 1]);
  });
  it.each([
    [(d: any) => { delete d.scenes[0].extras; }, /Custom Properties/],
    [(d: any) => { d.nodes[1].children = [0]; }, /cyclic/],
    [(d: any) => { d.nodes[1].scale = [0, 1, 1]; }, /zero-scale/],
    [(d: any) => { d.accessors[0].count = 4; }, /buffer/],
    [(d: any) => { d.buffers[0].uri = "https://example.com/mesh.bin"; }, /External/],
    [(d: any) => { d.extensionsRequired = ["KHR_draco_mesh_compression"]; }, /extensions/],
    [(d: any) => { d.animations = [{}]; }, /animation/],
  ])("rejects unsupported or malformed input before conversion", (mutate, error) => {
    const { document, binary } = simpleGlb(); mutate(document);
    expect(() => readBuildingGlb(glb(document, binary))).toThrow(error);
  });
  it("preserves container members, header padding and trailers when replacing a model", () => {
    const oldModel = new Uint8Array(20); oldModel.set(new TextEncoder().encode("BMD0")); writeU32(oldModel, 8, 16); oldModel.set([9, 8, 7, 6], 16);
    const original = concatBytes([packGameFreakContainer("AB", [Uint8Array.of(4, 3, 2, 1), oldModel, Uint8Array.of(5, 5, 5, 5)]), Uint8Array.of(99, 98)]);
    const replacement = new Uint8Array(24); replacement.set(new TextEncoder().encode("BMD0")); writeU32(replacement, 8, 24);
    const rebuilt = replaceBuildingModelMember(original, 1, replacement);
    expect(extractGameFreakContainer(rebuilt).files).toEqual([Uint8Array.of(4, 3, 2, 1), concatBytes([replacement, Uint8Array.of(9, 8, 7, 6)]), Uint8Array.of(5, 5, 5, 5)]);
    expect([...rebuilt.slice(-2)]).toEqual([99, 98]);
  });
});

async function assetGlb(asset: BuildingLibraryAsset, heightDelta = 0) {
  const parts: Uint8Array[] = [], bufferViews: any[] = [], accessors: any[] = [], meshes: any[] = [], materials: any[] = [];
  let length = 0;
  function add(values: Float32Array | Uint16Array, type: string, width: number) {
    const bytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
    bufferViews.push({ buffer: 0, byteOffset: length, byteLength: bytes.length });
    const padded = new Uint8Array((bytes.length + 3) & ~3); padded.set(bytes); parts.push(padded); length += padded.length;
    accessors.push({ bufferView: bufferViews.length - 1, componentType: values instanceof Float32Array ? 5126 : 5123, count: values.length / width, type });
    return accessors.length - 1;
  }
  for (const p of asset.primitives) {
    const attributes: Record<string, number> = { POSITION: add(p.positions.map((v, i) => (v + (i % 3 === 1 ? heightDelta : 0)) / 16), "VEC3", 3) };
    if (p.uvs) attributes.TEXCOORD_0 = add(p.uvs, "VEC2", 2);
    if (p.colors) attributes.COLOR_0 = add(p.colors, "VEC3", 3);
    if (p.normals) attributes.NORMAL = add(p.normals, "VEC3", 3);
    materials.push({ name: p.material.name });
    meshes.push({ primitives: [{ attributes, indices: add(p.indices, "SCALAR", 1), material: materials.length - 1 }] });
  }
  return glb({ asset: { version: "2.0" }, buffers: [{ byteLength: length }], bufferViews, accessors, materials, meshes,
    nodes: meshes.map((_m, i) => ({ mesh: i })), scene: 0, scenes: [{ nodes: meshes.map((_m, i) => i), extras: { pokeweb: {
      buildingImportVersion: 1, content: "Static building model", bundleKind: asset.kind, bundleId: asset.bundleId, uid: asset.uid, resourceIndex: asset.resourceIndex,
      sourceModelHash: await modelAssetHash(asset.modelBytes), sourceOrigin: [0, 0, 0], scaleFromSource: 1 / 16,
    } } }] }, concatBytes(parts));
}

const romPath = resolve(process.cwd(), "../cleanwhite2.nds");
describe.skipIf(!existsSync(romPath))("local BW2 static building conversion", () => {
  async function setup() {
    const project = await loadProjectFromRomBytes(new Uint8Array(readFileSync(romPath)), "cleanwhite2.nds", { selectedNarcs: ["maps"] });
    const library = await loadBuildingLibrary(project);
    return { project, library, asset: library.load("exterior:52:29") };
  }
  it.each([1, 2, 3])("retains unused UV-mode %i materials but rejects them when drawn", async mode => {
    const { asset } = await setup();
    const records = materialRecords(asset.modelBytes), target = records.find(r => r.name === asset.primitives[0].material.name)!;
    const bytes = new Uint8Array(mode === 1 ? 60 : 108); bytes.set(target.bytes.subarray(0, 44));
    writeU16(bytes, 2, bytes.length);
    writeU32(bytes, 20, ((readU32(bytes, 20) & 0x3fffffff) | (mode << 30)) >>> 0);
    writeU16(bytes, 30, readU16(bytes, 30) & ~8); // Non-identity translation in mode 1.
    target.bytes = bytes;
    const template = replaceMaterialRecords(asset.modelBytes, records);
    const meshes = asset.primitives.map(p => ({ ...p, materialName: p.material.name }));
    expect(() => writeStaticNitroModel(template, meshes)).toThrow(`Material "${target.name}" uses generated/transformed texture coordinates`);
    const remaining = meshes.filter(m => m.materialName !== target.name);
    expect(remaining.length).toBeGreaterThan(0);
    const output = writeStaticNitroModel(template, remaining), resources = readNitroResources(output);
    expect(materialRecords(output)).toEqual(records);
    expect(resources.models[0].renderOps.some(op => op.kind === "bindMaterial" && op.material === records.indexOf(target))).toBe(false);
    expect(buildModelPrimitives(resources, [], { includeHiddenMaterials: true }).some(p => p.material.name === target.name)).toBe(false);
  });
  it("still checks UV modes on automatically preserved shadow geometry", async () => {
    const { asset } = await setup(), records = materialRecords(asset.modelBytes);
    const shadow = buildModelPrimitives(readNitroResources(asset.modelBytes), [], { includeHiddenMaterials: true })
      .find(p => p.material.name.toLowerCase().includes("h_kage") || p.material.texture?.name.toLowerCase().includes("h_kage"))!;
    expect(shadow).toBeDefined();
    const record = records.find(r => r.name === shadow.material.name)!;
    writeU32(record.bytes, 20, ((readU32(record.bytes, 20) & 0x3fffffff) | 0x80000000) >>> 0);
    const template = replaceMaterialRecords(asset.modelBytes, records);
    expect(() => writeStaticNitroModel(template, asset.primitives.map(p => ({ ...p, materialName: p.material.name }))))
      .toThrow(`Material "${record.name}" uses generated/transformed texture coordinates`);
  });
  it("rebuilds native geometry while preserving native materials and hidden shadow geometry", async () => {
    const { asset } = await setup();
    const before = readNitroResources(asset.modelBytes);
    const meshes = asset.primitives.map(p => ({ ...p, materialName: p.material.name }));
    const output = writeStaticNitroModel(asset.modelBytes, meshes);
    const after = readNitroResources(output);
    expect(after.models[0].materials).toEqual(before.models[0].materials);
    const allBefore = buildModelPrimitives(before, [], { includeHiddenMaterials: true });
    const warnings: string[] = [];
    const allAfter = buildModelPrimitives(after, warnings, { includeHiddenMaterials: true });
    expect(warnings).toEqual([]);
    // Quad reconstruction can reorder triangles and cyclically rotate their vertices.
    const asMeshes = (p: typeof allBefore) => p.map(mesh => ({ ...mesh, materialName: mesh.material.name }));
    expect(sameStaticGeometry(asMeshes(allBefore), asMeshes(allAfter))).toBe(true);
    expect(sameStaticGeometry(asMeshes(allAfter), asMeshes(allBefore))).toBe(true);
  });
  it("imports geometry changes, refreshes both previews, survives ROM export/reload, and can undo", async () => {
    const { project, asset } = await setup();
    const originalMap = await loadMap3dZone(project, 427);
    const staged = await prepareBuildingImport(asset, await assetGlb(asset, 8));
    expect(project.narcs.exterior_building_models).toBeUndefined();
    await applyBuildingImport(project, staged);
    const updated = (await loadBuildingLibrary(project)).load(asset.id);
    expect(updated.modelBytes).toEqual(staged.converted.modelBytes);
    const changedMap = await loadMap3dZone(project, 427);
    expect(changedMap).not.toBe(originalMap);
    const building = changedMap.buildings.find(b => b.uid === asset.uid)!;
    expect(Math.max(...building.primitives.flatMap(p => Array.from(p.positions).filter((_v, i) => i % 3 === 1)))).toBeCloseTo(95.796875, 2);
    const exported = new NintendoDSRom(await exportModifiedRom(project));
    const original = new NintendoDSRom(project.originalRomBytes!);
    const native = new NARC(exported.getFileByName("a/2/2/5"));
    const base = new NARC(original.getFileByName("a/2/2/5"));
    const oldMembers = extractGameFreakContainer(base.files[52]).files;
    const newMembers = extractGameFreakContainer(native.files[52]).files;
    for (let i = 0; i < oldMembers.length; i++) expect(newMembers[i]).toEqual(i === oldMembers.length / 2 + 29 ? staged.converted.modelBytes : oldMembers[i]);
    for (let i = 0; i < native.files.length; i++) if (i !== 52) expect(native.files[i]).toEqual(base.files[i]);
    const reloaded = await loadProjectFromRomBytes(exported.save(), "edited.nds", { selectedNarcs: [] });
    expect((await loadBuildingLibrary(reloaded)).load(asset.id).modelBytes).toEqual(staged.converted.modelBytes);
    await expect(applyBuildingImport(project, staged)).rejects.toThrow(/changed/);
    await applyBuildingImport(project, staged, true);
    expect(project.narcs.exterior_building_models!.rawFiles[52]).toEqual(base.files[52]);
  }, 30000);
  it("rejects stale, mismatched, animated, and invalid geometry inputs", async () => {
    const { asset, library } = await setup();
    const bytes = await assetGlb(asset);
    await expect(prepareBuildingImport({ ...asset, uid: 999 }, bytes)).rejects.toThrow(/different building/);
    const changed = asset.modelBytes.slice(); changed[changed.length - 1] ^= 1;
    await expect(prepareBuildingImport({ ...asset, modelBytes: changed }, bytes)).rejects.toThrow(/changed since/);
    await expect(prepareBuildingImport(library.load("exterior:52:3"), bytes)).rejects.toThrow(/Animated/);
    const mesh = { ...asset.primitives[0], materialName: "unknown" };
    expect(() => writeStaticNitroModel(asset.modelBytes, [mesh])).toThrow(/Unknown material/);
    const lit = asset.primitives.find(p => p.normals && !p.colors)!;
    expect(() => writeStaticNitroModel(asset.modelBytes, [{ ...lit, materialName: lit.material.name, normals: undefined }])).toThrow(/normals/);
    expect(() => writeStaticNitroModel(asset.modelBytes, [{ ...mesh, materialName: asset.primitives[0].material.name, indices: new Uint16Array([65000, 0, 1]) }])).toThrow(/invalid vertex/);
  });
});
