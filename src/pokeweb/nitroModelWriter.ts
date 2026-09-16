import { concatBytes, readAscii, readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { buildModelPrimitives, readNitroResources } from "./map3dModel";
import { compileStaticFaces } from "./nitroGeometryFaces";

export type StaticModelMesh = {
  materialName: string;
  positions: Float32Array;
  indices: Uint32Array | Uint16Array;
  uvs?: Float32Array;
  colors?: Float32Array;
  normals?: Float32Array;
};

const align4 = (n: number) => (n + 3) & ~3;
function requireValue(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}
function range(bytes: Uint8Array, offset: number, size: number) {
  requireValue(Number.isSafeInteger(offset) && Number.isSafeInteger(size) && offset >= 0 && size >= 0 && offset + size <= bytes.length, "Invalid native model offset.");
}
function dictionary(bytes: Uint8Array, offset: number): Uint8Array {
  range(bytes, offset, 16);
  const count = bytes[offset + 1];
  const size = 16 + count * 24;
  range(bytes, offset, size);
  requireValue(readU16(bytes, offset + 12 + count * 4) === 4, "Unsupported native dictionary entry size.");
  return bytes.slice(offset, offset + size);
}
function datumOffset(dict: Uint8Array, index: number) { return 16 + dict[1] * 4 + index * 4; }
function powerScale(maximum: number) { return Math.max(1, 2 ** Math.ceil(Math.log2(Math.max(maximum, 1) / 7.999))); }
function fixed16(value: number, fractionalBits: number, label: string): number {
  const encoded = Math.round(value * 2 ** fractionalBits);
  requireValue(Number.isFinite(encoded) && encoded >= -32768 && encoded <= 32767, `${label} exceeds the DS fixed-point range.`);
  return encoded & 0xffff;
}

/** Compile static geometry, retaining the template's material dictionaries and texture blocks.
 * One shape per existing material lets us reuse the native name-search trees exactly.
 * No SDK executable or SDK implementation is bundled with this writer.
 */
export function writeStaticNitroModel(template: Uint8Array, editedMeshes: StaticModelMesh[]): Uint8Array {
  requireValue(readAscii(template, 0, 4) === "BMD0", "The selected asset is not an NSBMD model.");
  const resources = readNitroResources(template);
  requireValue(resources.models.length === 1, "This first importer supports single-model buildings only.");
  const source = resources.models[0];
  const materials = source.materials;
  requireValue(materials.length > 0 && materials.length <= 255, "Unsupported material count.");
  requireValue(new Set(materials.map(m => m.name)).size === materials.length, "Native material names must be unique.");
  requireValue(materials.every(m => m.textureTransformMode === 0), "This building uses generated/transformed texture coordinates, which are not supported yet.");

  const blocks: Uint8Array[] = [];
  let mdlIndex = -1;
  for (let i = 0; i < readU16(template, 14); i++) {
    const offset = readU32(template, 16 + i * 4);
    range(template, offset, 8);
    const size = readU32(template, offset + 4);
    range(template, offset, size);
    if (readAscii(template, offset, 4) === "MDL0") mdlIndex = blocks.length;
    blocks.push(template.slice(offset, offset + size));
  }
  requireValue(mdlIndex >= 0, "Missing MDL0 block.");
  const mdl = blocks[mdlIndex];
  const modelDict = dictionary(mdl, 8);
  requireValue(modelDict[1] === 1, "Only single-model buildings are supported.");
  const modelOffset = readU32(modelDict, datumOffset(modelDict, 0));
  range(mdl, modelOffset, 64);
  const modelSize = readU32(mdl, modelOffset);
  range(mdl, modelOffset, modelSize);
  const original = mdl.slice(modelOffset, modelOffset + modelSize);
  const sbcOffset = readU32(original, 4);
  const matOffset = readU32(original, 8);
  const shpOffset = readU32(original, 12);
  requireValue(sbcOffset >= 64 && matOffset > sbcOffset && shpOffset > matOffset && shpOffset <= original.length, "Unsupported native model section layout.");
  // Reject operations whose behavior cannot be represented by this static compiler.
  let ended = false;
  for (let cursor = sbcOffset; cursor < matOffset;) {
    const command = original[cursor++];
    const kind = command & 31;
    const flags = command >>> 5;
    if (kind === 1) { ended = true; break; }
    requireValue([0, 2, 3, 4, 5, 6, 11].includes(kind), "Billboards, skinning, and custom model draw commands are not supported yet.");
    cursor += kind === 2 ? 2 : [3, 4, 5].includes(kind) ? 1 : kind === 6 ? 3 + ((flags & 1) ? 1 : 0) + ((flags & 2) ? 1 : 0) : 0;
    requireValue(cursor <= matOffset, "Truncated native draw commands.");
  }
  requireValue(ended, "Native draw commands have no terminator.");

  const sourcePrimitives = buildModelPrimitives(resources, [], { includeHiddenMaterials: true });
  const hidden = (name: string) => name.toLowerCase().includes("h_kage") || materials.find(m => m.name === name)?.textureName?.toLowerCase().includes("h_kage");
  // The viewer/exporter deliberately omits native shadow meshes. Keep those intact.
  const meshes: StaticModelMesh[] = [...editedMeshes, ...sourcePrimitives.filter(p => hidden(p.material.name)).map(p => ({ ...p, materialName: p.material.name }))];
  requireValue(editedMeshes.length > 0, "The GLB contains no building geometry.");
  requireValue(editedMeshes.every(m => !hidden(m.materialName)), "Native shadow materials are preserved automatically and cannot be replaced yet.");
  const byMaterial = materials.map(m => meshes.filter(mesh => mesh.materialName === m.name));
  const usesNormals = (name: string) => sourcePrimitives.some(p => p.material.name === name && p.normals && !p.colors);
  const usesColors = (name: string) => sourcePrimitives.some(p => p.material.name === name && p.colors);
  let triangles = 0;
  let maxCoordinate = 0;
  const minimum = [Infinity, Infinity, Infinity];
  const maximum = [-Infinity, -Infinity, -Infinity];
  for (const mesh of meshes) {
    requireValue(materials.some(m => m.name === mesh.materialName), `Unknown material "${mesh.materialName}". Keep the original building materials.`);
    requireValue(mesh.uvs || !materials.find(m => m.name === mesh.materialName)?.textureName, `Material "${mesh.materialName}" requires UV coordinates.`);
    requireValue(mesh.colors || !usesColors(mesh.materialName), `Material "${mesh.materialName}" requires vertex colors. Include color attributes when exporting from Blender.`);
    requireValue(mesh.colors || mesh.normals || !usesNormals(mesh.materialName), `Material "${mesh.materialName}" requires normals. Include normals when exporting from Blender.`);
    const count = mesh.positions.length / 3;
    requireValue(Number.isInteger(count) && count > 0 && mesh.indices.length > 0 && mesh.indices.length % 3 === 0, "Meshes must contain indexed triangles.");
    for (const [values, size] of [[mesh.uvs, 2], [mesh.colors, 3], [mesh.normals, 3]] as const) {
      requireValue(!values || values.length === count * size, "Mesh attributes have inconsistent vertex counts.");
      requireValue(!values || values.every(Number.isFinite), "Mesh attributes must be finite.");
    }
    requireValue(mesh.positions.every(Number.isFinite), "Vertex positions must be finite.");
    for (const index of mesh.indices) {
      requireValue(Number.isInteger(index) && index >= 0 && index < count, "Mesh contains an invalid vertex index.");
      for (let axis = 0; axis < 3; axis++) {
        const value = mesh.positions[index * 3 + axis];
        maxCoordinate = Math.max(maxCoordinate, Math.abs(value));
        minimum[axis] = Math.min(minimum[axis], value);
        maximum[axis] = Math.max(maximum[axis], value);
      }
    }
    triangles += mesh.indices.length / 3;
  }
  requireValue(triangles <= 4096, "This model cannot fit the DS limit of 2,048 polygons, even after quad reconstruction.");
  const faces = byMaterial.map(compileStaticFaces);
  const polygons = faces.reduce((n, group) => n + group.length, 0);
  const submittedVertices = faces.flat().reduce((n, face) => n + face.length, 0);
  const quadCount = faces.flat().filter(face => face.length === 4).length;
  requireValue(polygons <= 2048 && submittedVertices <= 6144, "This model exceeds the DS geometry limit (2,048 polygons / 6,144 submitted vertices after quad reconstruction). Reduce its geometry.");
  const scale = powerScale(maxCoordinate);
  requireValue(scale <= 4096, "The building is too large for this static converter.");
  const materialBytes = original.slice(matOffset, shpOffset);
  const shapeDict = dictionary(materialBytes, 4);
  const displayLists: Uint8Array[] = [];
  const shapeFlags: number[] = [];
  for (const [materialId, material] of materials.entries()) {
    const commands: { opcode: number; params: number[] }[] = [];
    const emit = (opcode: number, ...params: number[]) => commands.push({ opcode, params });
    let mode: number | undefined;
    let flags = 0;
    for (const face of faces[materialId]) {
      const nextMode = face.length === 4 ? 1 : 0;
      if (mode !== nextMode) { if (mode !== undefined) emit(0x41); emit(0x40, nextMode); mode = nextMode; }
      for (const { mesh, index } of face) {
        if (mesh.uvs) {
          flags |= 4;
          const s = fixed16(mesh.uvs[index * 2] * material.width * (material.flipS ? 2 : 1), 4, "Texture U");
          const t = fixed16(mesh.uvs[index * 2 + 1] * material.height * (material.flipT ? 2 : 1), 4, "Texture V");
          emit(0x22, (s | (t << 16)) >>> 0);
        }
        if (mesh.colors) {
          flags |= 2;
          const color = [0, 1, 2].map(a => Math.round(Math.max(0, Math.min(1, mesh.colors![index * 3 + a])) * 31));
          emit(0x20, color[0] | (color[1] << 5) | (color[2] << 10));
        } else if (usesNormals(material.name) && mesh.normals) {
          flags |= 1;
          const n = [0, 1, 2].map(a => Math.max(-512, Math.min(511, Math.round(mesh.normals![index * 3 + a] * 512))) & 1023);
          emit(0x21, (n[0] | (n[1] << 10) | (n[2] << 20)) >>> 0);
        }
        const p = [0, 1, 2].map(a => fixed16(mesh.positions[index * 3 + a] / scale, 12, "Vertex"));
        emit(0x23, (p[0] | (p[1] << 16)) >>> 0, p[2]);
      }
    }
    if (mode !== undefined) emit(0x41);
    const words: number[] = [];
    for (let i = 0; i < commands.length; i += 4) {
      const group = commands.slice(i, i + 4);
      words.push(group.reduce((word, c, j) => word | (c.opcode << (j * 8)), 0));
      for (const command of group) words.push(...command.params);
    }
    const bytes = new Uint8Array(words.length * 4);
    words.forEach((word, i) => writeU32(bytes, i * 4, word));
    displayLists.push(bytes);
    shapeFlags.push(flags);
  }

  // A one-entry dictionary from the template already has a valid native search tree.
  const nodeDict = modelDict.slice();
  writeU32(nodeDict, datumOffset(nodeDict, 0), nodeDict.length);
  const node = new Uint8Array(4); writeU16(node, 0, 7); // identity translation, rotation and scale
  const sbc = [2, 0, 1, 6, 0, 0, 0, 11];
  const order = [...new Set(source.renderOps.flatMap(op => op.kind === "bindMaterial" ? [op.material] : [])), ...materials.map((_m, i) => i)];
  for (const i of new Set(order)) if (byMaterial[i]?.length) sbc.push(4, i, 5, i);
  sbc.push(0x2b, 1);
  const newSbcOffset = align4(64 + nodeDict.length + node.length);
  const newMatOffset = align4(newSbcOffset + sbc.length);
  const newShapeOffset = align4(newMatOffset + materialBytes.length);
  const shapeHeaders = new Uint8Array(materials.length * 16);
  let displayOffset = shapeDict.length + shapeHeaders.length;
  displayLists.forEach((bytes, i) => {
    const shapeOffset = shapeDict.length + i * 16;
    writeU32(shapeDict, datumOffset(shapeDict, i), shapeOffset);
    writeU16(shapeHeaders, i * 16 + 2, 16);
    writeU32(shapeHeaders, i * 16 + 4, shapeFlags[i]);
    writeU32(shapeHeaders, i * 16 + 8, displayOffset - shapeOffset);
    writeU32(shapeHeaders, i * 16 + 12, bytes.length);
    displayOffset += bytes.length;
  });
  const inverseOffset = newShapeOffset + displayOffset;
  const output = new Uint8Array(inverseOffset + 84); // one identity inverse position and normal matrix
  output.set(original.subarray(0, 64));
  writeU32(output, 0, output.length); writeU32(output, 4, newSbcOffset);
  writeU32(output, 8, newMatOffset); writeU32(output, 12, newShapeOffset); writeU32(output, 16, inverseOffset);
  output[20] = 0; output[21] = 0; output[23] = 1; output[24] = materials.length; output[25] = materials.length; output[26] = 1;
  writeU32(output, 28, Math.round(scale * 4096)); writeU32(output, 32, Math.round(4096 / scale));
  writeU16(output, 36, submittedVertices); writeU16(output, 38, polygons); writeU16(output, 40, polygons - quadCount); writeU16(output, 42, quadCount);
  const dimensions = maximum.map((v, i) => v - minimum[i]);
  const boxScale = powerScale(Math.max(...minimum.map(Math.abs), ...dimensions));
  requireValue(boxScale <= 4096, "The building's bounding box is too large for this static converter.");
  [...minimum, ...dimensions].forEach((v, i) => writeU16(output, 44 + i * 2, fixed16(v / boxScale, 12, "Bounding box")));
  writeU32(output, 56, boxScale * 4096); writeU32(output, 60, Math.round(4096 / boxScale));
  output.set(nodeDict, 64); output.set(node, 64 + nodeDict.length); output.set(sbc, newSbcOffset);
  output.set(materialBytes, newMatOffset); output.set(shapeDict, newShapeOffset); output.set(shapeHeaders, newShapeOffset + shapeDict.length);
  output.set(concatBytes(displayLists), newShapeOffset + shapeDict.length + shapeHeaders.length);
  for (const offset of [0, 16, 32, 48, 64, 80]) writeU32(output, inverseOffset + offset, 4096);

  const newMdl = new Uint8Array(8 + modelDict.length + output.length);
  newMdl.set(mdl.subarray(0, 8)); writeU32(newMdl, 4, newMdl.length);
  writeU32(modelDict, datumOffset(modelDict, 0), 8 + modelDict.length);
  newMdl.set(modelDict, 8); newMdl.set(output, 8 + modelDict.length); blocks[mdlIndex] = newMdl;
  const headerSize = 16 + blocks.length * 4;
  const result = new Uint8Array(headerSize + blocks.reduce((n, b) => n + align4(b.length), 0));
  result.set(template.subarray(0, 16)); writeU32(result, 8, result.length); writeU16(result, 12, 16);
  let offset = headerSize;
  blocks.forEach((block, i) => { writeU32(result, 16 + i * 4, offset); result.set(block, offset); offset += align4(block.length); });
  return result;
}
