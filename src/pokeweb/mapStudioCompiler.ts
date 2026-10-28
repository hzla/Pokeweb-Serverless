import { concatBytes, readU16, writeU16 } from "../nds/binary";
import { decodeGlbPng } from "./glbMaterialImport";
import { findStudioAsset, studioAssert, studioPerName, studioSidecar, type StudioChunk, type StudioWorkspace } from "./mapStudioFormats";
import { studioMeshes, studioSurface, type StudioMesh } from "./mapStudioModel";
import { compileStudioBuildings } from "./mapStudioBuildings";
import { optimizeStudioMesh } from "./mapStudioGeometry";
import { convertStudioGen4Permission, readStudioBdhc } from "./mapStudioGen4";
import { distances, slopesX, slopesY } from "./mapStudioHeightTables";
import { writeStaticNitroModel } from "./nitroModelWriter";
import type { NativeMaterialRecord } from "./nitroResourceWriter";
import { emptyTextures, modelTemplate, nativeMaterial } from "./mapStudioNative";
import { appendNitroTextures, encodeNitroTexture } from "./nitroTextureWriter";


export function compileStudioModel(workspace: StudioWorkspace, chunk: StudioChunk) {
  const records: NativeMaterialRecord[] = [], textures = [], images = new Map<number, ReturnType<typeof decodeGlbPng>>();
  const meshes = studioMeshes(workspace, chunk).map(mesh => {
    const source = workspace.tileset.materials[mesh.material]; studioAssert(source, "Missing tile material.");
    const path = findStudioAsset(workspace.files, workspace.tilesetPath, source.image), image = decodeGlbPng(workspace.files[path]); images.set(mesh.material, image);
    return optimizeStudioMesh(mesh, source, image.width, image.height);
  }); studioAssert(meshes.length > 0, "Paint terrain before inserting this chunk.");
  for (const mesh of meshes) {
    const source = workspace.tileset.materials[mesh.material]; studioAssert(source, "Missing tile material.");
    const image = images.get(mesh.material)!;
    const index = records.length; records.push(nativeMaterial(source, index, image.width, image.height)); textures.push(encodeNitroTexture({ ...image, name: `ms_tex_${index}` }));
  }
  const template = modelTemplate(records);
  const native = meshes.map((mesh, i) => ({ materialName: records[i].name, positions: new Float32Array(mesh.positions.map(n => n * 16)), uvs: new Float32Array(mesh.uvs.map((v, axis) => axis % 2 ? 1 - v : v)), colors: new Float32Array(mesh.colors), indices: new Uint32Array(mesh.indices) }));
  const model = writeStaticNitroModel(template, native, { stripify: true }), textureFile = appendNitroTextures(emptyTextures(), textures);
  return { model, textures: textureFile, meshes };
}

function closest(values: number[], value: number) { let best = 0; for (let i = 1; i < values.length; i++) if (Math.abs(values[i] - value) < Math.abs(values[best] - value)) best = i; return best; }
/** Builds corner tables with the same game-specific plane vocabulary as PDSMS. */
export function compileStudioPermissions(workspace: StudioWorkspace, chunk: StudioChunk, walkingLayer: number, game: "BW" | "BW2" = workspace.map.game < 7 ? "BW" : "BW2", notes: string[] = [], secondary = false): Uint8Array {
  const original = studioSidecar(workspace, chunk, "per"), gen4 = original?.length === 2048;
  const bdhc = walkingLayer === -1 && gen4 ? studioSidecar(workspace, chunk, "bdhc") : undefined;
  const plates = bdhc ? readStudioBdhc(bdhc) : undefined;
  if (walkingLayer === -1 && !gen4) {
    const source = secondary ? workspace.files[studioPerName(workspace, chunk, true)] : original;
    studioAssert(source && source.length >= 8196 && readU16(source, 0) === 32 && readU16(source, 2) === 32, "This project has no PER file. Choose a walking layer to generate collision heights.");
    studioAssert((workspace.map.game < 7 ? "BW" : "BW2") === game, "Project PER height indices belong to a different Gen 5 game family. Generate heights from a walking layer instead."); return source.slice();
  }
  studioAssert(walkingLayer !== -1 || plates, "This Gen 4 project needs its BDHC sidecar for walking heights.");
  const visible = Array(9).fill(false); visible[walkingLayer] = true;
  const meshes = plates ? [] : studioMeshes(workspace, chunk, visible), family = game === "BW" ? 0 : 1;
  const sx = slopesX[family], sy = slopesY[family], ds = distances[family], corners: number[] = [];
  const out = new Uint8Array(8196); writeU16(out, 0, 32); writeU16(out, 2, 32);
  if (original && !gen4 && original.length >= 8196) out.set(original.subarray(4, 8196), 4);
  const unsupported = new Set<number>(); let maxError = 0;
  if (gen4) for (let i = 0; i < 1024; i++) {
    const mapped = convertStudioGen4Permission(original[i * 2], original[i * 2 + 1]);
    writeU16(out, 8 + i * 8, mapped.tileClass); writeU16(out, 10 + i * 8, mapped.flags);
    if (mapped.unsupported !== undefined) unsupported.add(mapped.unsupported);
  }
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
    const candidates = plates?.filter(p => x - 15.5 >= p.x0 && x - 15.5 < p.x1 && y - 15.5 >= p.y0 && y - 15.5 < p.y1)
      .sort((p, q) => (q.a - p.a) * (x - 15.5) + (q.b - p.b) * (y - 15.5) + q.c - p.c);
    const plate = candidates?.[secondary && candidates.length > 1 ? 1 : 0];
    const heights = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([dx, dy]) => plates ? plate && plate.a * (x - 16 + dx) + plate.b * (y - 16 + dy) + plate.c : studioSurface(bins[i], x - 16 + dx, y - 16 + dy));
    if (heights.some(h => h === undefined)) { writeU16(out, at, 0); writeU16(out, at + 2, 0); writeU16(out, at + 6, readU16(out, at + 6) | 1); continue; }
    const z = heights as number[], plane = (a: number, b: number, corner: number) => {
      let slope = 0; for (let s = 1; s < sx.length; s++) if ((sx[s] - a) ** 2 + (sy[s] - b) ** 2 < (sx[slope] - a) ** 2 + (sy[slope] - b) ** 2) slope = s;
      const dx = [0, 1, 1, 0][corner], dy = [0, 0, 1, 1][corner], cx = x - 15.5, cy = y - 15.5;
      const middle = z[corner] + a * (0.5 - dx) + b * (0.5 - dy);
      const distance = (middle - sx[slope] * cx - sy[slope] * cy) / Math.sqrt(sx[slope] ** 2 + sy[slope] ** 2 + 1), d = closest(ds, distance);
      const actual = sx[slope] * cx + sy[slope] * cy + ds[d] * Math.sqrt(sx[slope] ** 2 + sy[slope] ** 2 + 1);
      const error = Math.abs(actual - middle) + Math.abs(sx[slope] - a) / 2 + Math.abs(sy[slope] - b) / 2;
      studioAssert(error < 0.26, `Walking height at ${x}, ${y} differs by ${error.toFixed(2)} tiles from the closest ${game} plane. Edit the walking surface before inserting.`);
      maxError = Math.max(maxError, error);
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
  if (maxError > 0.02) notes.push(`Walking planes quantized to ${game}: maximum height difference ${maxError.toFixed(3)} tiles.`);
  if (unsupported.size) notes.push(`Gen 4 behavior IDs needing Gen 5 setup: ${[...unsupported].sort((a,b) => a-b).map(n => "0x" + n.toString(16).padStart(2, "0")).join(", ")}. Collision remains intact; warps, field moves and bridge behavior need destination events.`);
  const tail = new Uint8Array(corners.length * 2); corners.forEach((n, i) => writeU16(tail, i * 2, n)); return concatBytes([out, tail]);
}
export function compileStudioChunk(workspace: StudioWorkspace, chunkIndex: number, walkingLayer: number, game: "BW" | "BW2" = workspace.map.game < 7 ? "BW" : "BW2") {
  const chunk = workspace.map.chunks[chunkIndex]; studioAssert(chunk, "Choose a source chunk.");
  const notes: string[] = [], { model, textures } = compileStudioModel(workspace, chunk), permissions = compileStudioPermissions(workspace, chunk, walkingLayer, game, notes);
  const buildings = compileStudioBuildings(workspace, chunk);
  let secondaryPermissions: Uint8Array | null = workspace.files[studioPerName(workspace, chunk, true)] ?? null;
  const bdhc = studioSidecar(workspace, chunk, "bdhc");
  if (walkingLayer === -1 && studioSidecar(workspace, chunk, "per")?.length === 2048 && bdhc) {
    const plates = readStudioBdhc(bdhc);
    const overlapping = plates.some((p, i) => plates.some((q, j) => j > i && Math.min(p.x1, q.x1) > Math.max(p.x0, q.x0) && Math.min(p.y1, q.y1) > Math.max(p.y0, q.y0)));
    if (overlapping) secondaryPermissions = compileStudioPermissions(workspace, chunk, -1, game, notes, true);
  }
  if (buildings?.placements.length) notes.push("Gen 4 buildings imported as static models; source animations are not converted.");
  return { game, model, textures, permissions, secondaryPermissions, buildings, notes: [...new Set(notes)] };
}
