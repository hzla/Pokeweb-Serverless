import { concatBytes, readU16, writeU16, writeU32 } from "../nds/binary";
import { decodeGlbPng } from "./glbMaterialImport";
import { findStudioAsset, studioAssert, studioPerName, type StudioChunk, type StudioMaterial, type StudioWorkspace } from "./mapStudioFormats";
import { studioMeshes, studioSurface, type StudioMesh } from "./mapStudioModel";
import { distances, slopesX, slopesY } from "./mapStudioHeightTables";
import { writeStaticNitroModel } from "./nitroModelWriter";
import { align, writeDictionary, writeNitroFile, type NativeMaterialRecord } from "./nitroResourceWriter";
import { appendNitroTextures, encodeNitroTexture } from "./nitroTextureWriter";

function fileHeader(stamp: string, version: number) {
  const bytes = new Uint8Array(16); bytes.set(new TextEncoder().encode(stamp)); writeU16(bytes, 4, 0xfeff); writeU16(bytes, 6, version); writeU16(bytes, 12, 16); return bytes;
}
function emptyTextures() {
  const tex = new Uint8Array(96); tex.set(new TextEncoder().encode("TEX0")); writeU32(tex, 4, tex.length);
  writeU16(tex, 14, 60); writeU16(tex, 30, 60); writeU32(tex, 52, 76);
  for (const offset of [20, 36, 40, 56]) writeU32(tex, offset, 96);
  tex.set(writeDictionary([], 8), 60); tex.set(writeDictionary([], 4), 76);
  return writeNitroFile(fileHeader("BTX0", 1), [tex]);
}
function materialSection(records: NativeMaterialRecord[]) {
  const entries = records.map(r => ({ name: r.name, data: new Uint8Array(4) }));
  let cursor = 4 + writeDictionary(entries, 4).length;
  const pairings = (["textureName", "paletteName"] as const).map(field => {
    const groups = new Map<string, number[]>(); records.forEach((r, i) => { const name = r[field]; if (name) { const ids = groups.get(name) ?? []; ids.push(i); groups.set(name, ids); } });
    const pairs = [...groups].map(([name]) => ({ name, data: new Uint8Array(4) })); const offset = cursor; cursor += writeDictionary(pairs, 4).length;
    for (const [i, ids] of [...groups.values()].entries()) { writeU16(pairs[i].data, 0, cursor); pairs[i].data[2] = ids.length; cursor += ids.length; }
    const bytes = concatBytes([writeDictionary(pairs, 4), new Uint8Array([...groups.values()].flat()), new Uint8Array(align(cursor) - cursor)]); cursor = align(cursor); return { offset, bytes };
  });
  records.forEach((r, i) => { writeU32(entries[i].data, 0, cursor); cursor += align(r.bytes.length); });
  const segment = new Uint8Array(cursor); writeU16(segment, 0, pairings[0].offset); writeU16(segment, 2, pairings[1].offset);
  segment.set(writeDictionary(entries, 4), 4); pairings.forEach(p => segment.set(p.bytes, p.offset));
  let at = cursor - records.reduce((sum, r) => sum + align(r.bytes.length), 0); for (const r of records) { segment.set(r.bytes, at); at += align(r.bytes.length); }
  return segment;
}
/** A fresh, SDK-independent native model scaffold; no ROM template is needed. */
function modelTemplate(records: NativeMaterialRecord[]) {
  const root = writeDictionary([{ name: "root", data: new Uint8Array(4) }], 4);
  // Dictionary datum offsets are obtained from the entry table, not names.
  const rv = new DataView(root.buffer), re = rv.getUint16(6, true); writeU32(root, re + 4, root.length);
  const node = new Uint8Array(4); writeU16(node, 0, 7);
  const sbc = Uint8Array.of(2, 0, 1, 6, 0, 0, 0, 11, 1), mat = materialSection(records), shapes = writeDictionary([], 4);
  const sbcAt = align(64 + root.length + 4), matAt = align(sbcAt + sbc.length), shapesAt = matAt + mat.length, inverseAt = align(shapesAt + shapes.length);
  const model = new Uint8Array(inverseAt + 84); writeU32(model, 0, model.length); writeU32(model, 4, sbcAt); writeU32(model, 8, matAt); writeU32(model, 12, shapesAt); writeU32(model, 16, inverseAt);
  model[23] = 1; model[24] = records.length; writeU32(model, 28, 4096); writeU32(model, 32, 4096); writeU32(model, 56, 4096); writeU32(model, 60, 4096);
  model.set(root, 64); model.set(node, 64 + root.length); model.set(sbc, sbcAt); model.set(mat, matAt); model.set(shapes, shapesAt);
  for (const offset of [0, 16, 32, 48, 64, 80]) writeU32(model, inverseAt + offset, 4096);
  const dict = writeDictionary([{ name: "mapstudio", data: new Uint8Array(4) }], 4), entry = new DataView(dict.buffer).getUint16(6, true); writeU32(dict, entry + 4, 8 + dict.length);
  const mdl = new Uint8Array(8 + dict.length + model.length); mdl.set(new TextEncoder().encode("MDL0")); writeU32(mdl, 4, mdl.length); mdl.set(dict, 8); mdl.set(model, 8 + dict.length);
  return writeNitroFile(fileHeader("BMD0", 2), [mdl]);
}
function rgb(values: number[]) { return values.reduce((n, v, i) => n | Math.max(0, Math.min(31, Math.round(v))) << (i * 5), 0); }
function nativeMaterial(source: StudioMaterial, index: number, width: number, height: number): NativeMaterialRecord {
  studioAssert(source.texGen === 0, `Material ${source.name} uses generated texture coordinates. Bake its UVs before inserting.`);
  const bytes = new Uint8Array(44); writeU16(bytes, 0, 0); writeU16(bytes, 2, 44);
  writeU32(bytes, 4, (rgb(source.diffuse) | 0x8000 | rgb(source.ambient) << 16) >>> 0); writeU32(bytes, 8, (rgb(source.specular) | rgb(source.emission) << 16) >>> 0);
  writeU32(bytes, 12, (source.light.reduce((n, v, i) => n | (v ? 1 << i : 0), 0) | (source.bothFaces ? 3 : 2) << 6 | (source.fog ? 1 << 15 : 0) | source.alpha << 16) >>> 0);
  writeU32(bytes, 16, 0x3f1f08ff);
  const wrap = (source.repeatU ? 1 : 0) | (source.repeatV ? 2 : 0) | (source.repeatU === 2 ? 4 : 0) | (source.repeatV === 2 ? 8 : 0);
  writeU32(bytes, 20, (wrap << 16) >>> 0); writeU32(bytes, 24, 0xffffffff); writeU16(bytes, 30, 15); writeU16(bytes, 32, width); writeU16(bytes, 34, height); writeU32(bytes, 36, 4096); writeU32(bytes, 40, 4096);
  return { name: `ms_mat_${index}`, bytes, textureName: `ms_tex_${index}`, paletteName: `ms_tex_${index}` };
}

export function compileStudioModel(workspace: StudioWorkspace, chunk: StudioChunk) {
  const meshes = studioMeshes(workspace, chunk); studioAssert(meshes.length > 0, "Paint terrain before inserting this chunk.");
  const records: NativeMaterialRecord[] = [], textures = [];
  for (const mesh of meshes) {
    const source = workspace.tileset.materials[mesh.material]; studioAssert(source, "Missing tile material.");
    const path = findStudioAsset(workspace.files, workspace.tilesetPath, source.image), image = decodeGlbPng(workspace.files[path]);
    const index = records.length; records.push(nativeMaterial(source, index, image.width, image.height)); textures.push(encodeNitroTexture({ ...image, name: `ms_tex_${index}` }));
  }
  const template = modelTemplate(records);
  const native = meshes.map((mesh, i) => ({ materialName: records[i].name, positions: new Float32Array(mesh.positions.map(n => n * 16)), uvs: new Float32Array(mesh.uvs.map((v, axis) => axis % 2 ? 1 - v : v)), colors: new Float32Array(mesh.colors), indices: new Uint32Array(mesh.indices) }));
  const model = writeStaticNitroModel(template, native), textureFile = appendNitroTextures(emptyTextures(), textures);
  return { model, textures: textureFile, meshes };
}

function closest(values: number[], value: number) { let best = 0; for (let i = 1; i < values.length; i++) if (Math.abs(values[i] - value) < Math.abs(values[best] - value)) best = i; return best; }
/** Builds corner tables with the same game-specific plane vocabulary as PDSMS. */
export function compileStudioPermissions(workspace: StudioWorkspace, chunk: StudioChunk, walkingLayer: number): Uint8Array {
  const original = workspace.files[studioPerName(workspace, chunk)];
  if (walkingLayer === -1) { studioAssert(original && original.length >= 8196 && readU16(original, 0) === 32 && readU16(original, 2) === 32, "This project has no Gen 5 PER file. Choose a walking layer to generate Gen 5 collision heights."); return original.slice(); }
  const visible = Array(9).fill(false); visible[walkingLayer] = true;
  const meshes = studioMeshes(workspace, chunk, visible), family = workspace.map.game < 7 ? 0 : 1;
  const sx = slopesX[family], sy = slopesY[family], ds = distances[family], corners: number[] = [];
  const out = new Uint8Array(8196); writeU16(out, 0, 32); writeU16(out, 2, 32);
  if (original?.length >= 8196) out.set(original.subarray(4, 8196), 4);
  // Index projected triangles once; walking-height generation stays proportional to geometry.
  const bins: StudioMesh[][] = Array.from({ length: 1024 }, () => []);
  for (const mesh of meshes) for (let f = 0; f < mesh.indices.length; f += 3) {
    const ids = mesh.indices.slice(f, f + 3), points = ids.map(i => mesh.positions.slice(i * 3, i * 3 + 3));
    const minX = Math.max(0, Math.floor(Math.min(...points.map(p => p[0])) + 16)), maxX = Math.min(31, Math.ceil(Math.max(...points.map(p => p[0])) + 16) - 1);
    const minY = Math.max(0, Math.floor(Math.min(...points.map(p => p[2])) + 16)), maxY = Math.min(31, Math.ceil(Math.max(...points.map(p => p[2])) + 16) - 1);
    const triangle: StudioMesh = { material: 0, positions: points.flat(), indices: [0, 1, 2], uvs: [], colors: [] };
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) bins[y * 32 + x].push(triangle);
  }
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const i = y * 32 + x, at = 4 + i * 8;
    const heights = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([dx, dy]) => studioSurface(bins[i], x - 16 + dx, y - 16 + dy));
    if (heights.some(h => h === undefined)) { writeU16(out, at, 0); writeU16(out, at + 2, 0); writeU16(out, at + 6, readU16(out, at + 6) | 1); continue; }
    const z = heights as number[], plane = (a: number, b: number, corner: number) => {
      let slope = 0; for (let s = 1; s < sx.length; s++) if ((sx[s] - a) ** 2 + (sy[s] - b) ** 2 < (sx[slope] - a) ** 2 + (sy[slope] - b) ** 2) slope = s;
      const dx = [0, 1, 1, 0][corner], dy = [0, 0, 1, 1][corner];
      const distance = (z[corner] - sx[slope] * (x - 16 + dx) - sy[slope] * (y - 16 + dy)) / Math.sqrt(sx[slope] ** 2 + sy[slope] ** 2 + 1), d = closest(ds, distance);
      studioAssert(Math.abs(sx[slope] - a) < 0.02 && Math.abs(sy[slope] - b) < 0.02 && Math.abs(ds[d] - distance) < 0.02, `Walking surface at ${x}, ${y} cannot be represented by this game's height table. Choose a simpler walking layer or keep the project PER.`);
      return [slope, d];
    };
    const a = z[1] - z[0], b = z[3] - z[0], c = z[2] - z[3], d = z[2] - z[1];
    if (Math.abs(a - c) < 0.01 && Math.abs(b - d) < 0.01) { const p = plane(a, b, 0); writeU16(out, at, p[0] * 4); writeU16(out, at + 2, p[1]); }
    else {
      const split02 = Math.abs(z[0] - z[2]) > Math.abs(z[1] - z[3]);
      const p = plane(a, split02 ? d : b, 0), q = plane(c, split02 ? b : d, split02 ? 0 : 1);
      writeU16(out, at, 2); writeU16(out, at + 2, corners.length / 4); corners.push(p[0] * 4 + 1, q[0], p[1], q[1]);
    }
    if (!original) writeU16(out, at + 6, 0);
  }
  const tail = new Uint8Array(corners.length * 2); corners.forEach((n, i) => writeU16(tail, i * 2, n)); return concatBytes([out, tail]);
}
export function compileStudioChunk(workspace: StudioWorkspace, chunkIndex: number, walkingLayer: number) {
  studioAssert(workspace.map.game >= 5 && workspace.map.game <= 8, "Choose Black/White or Black 2/White 2 as the project game before inserting into a Gen 5 ROM. Gen 4 collision and building sidecars remain archived in the project bundle.");
  const chunk = workspace.map.chunks[chunkIndex]; studioAssert(chunk, "Choose a source chunk.");
  const { model, textures } = compileStudioModel(workspace, chunk), permissions = compileStudioPermissions(workspace, chunk, walkingLayer);
  return { game: workspace.map.game < 7 ? "BW" as const : "BW2" as const, model, textures, permissions, secondaryPermissions: workspace.files[studioPerName(workspace, chunk, true)] };
}
