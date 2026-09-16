import { Matrix3, Matrix4, Quaternion, Vector3 } from "three";
import type { StaticModelMesh } from "./nitroModelWriter";

export type BuildingGlbMetadata = {
  buildingImportVersion: number;
  content: string;
  bundleKind: string;
  bundleId: number;
  uid: number;
  resourceIndex: number;
  sourceModelHash: string;
  sourceOrigin: number[];
  scaleFromSource: number;
};

function check(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }
export async function modelAssetHash(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}

export type StaticGlbNode = { index: number; extras: Record<string, unknown>; world: Matrix4; meshes: StaticModelMesh[]; children: StaticGlbNode[] };

/** Decode embedded geometry without executing extensions or fetching external resources. */
export function readStaticGlb(bytes: Uint8Array, triangleLimit = 200_000): { metadata: any; nodes: StaticGlbNode[]; document: any; binary: Uint8Array } {
  check(bytes.length >= 28 && bytes.length <= 64 * 1024 * 1024, "Choose a GLB smaller than 64 MB.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  check(view.getUint32(0, true) === 0x46546c67 && view.getUint32(4, true) === 2 && view.getUint32(8, true) === bytes.length, "Invalid GLB 2.0 header.");
  let document: any;
  let binary: Uint8Array | undefined;
  for (let offset = 12; offset < bytes.length;) {
    check(offset + 8 <= bytes.length, "Truncated GLB chunk.");
    const length = view.getUint32(offset, true), type = view.getUint32(offset + 4, true);
    check(length % 4 === 0 && offset + 8 + length <= bytes.length, "Invalid GLB chunk length.");
    const chunk = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) { check(!document && offset === 12, "Invalid GLB JSON chunk."); document = JSON.parse(new TextDecoder().decode(chunk)); }
    if (type === 0x004e4942) { check(!binary, "Multiple binary buffers are unsupported."); binary = chunk; }
    offset += 8 + length;
  }
  check(document?.asset?.version === "2.0" && binary, "GLB must include geometry in an embedded binary buffer.");
  check(document.buffers?.length === 1 && !document.buffers[0].uri && Number.isSafeInteger(document.buffers[0].byteLength)
    && document.buffers[0].byteLength >= 0 && document.buffers[0].byteLength <= binary.length, "External or invalid GLB buffers are unsupported.");
  check(!(document.extensionsRequired ?? []).some((name: string) => name !== "KHR_materials_unlit"), "The GLB requires unsupported extensions. Export without compression or instancing extensions.");
  check(!document.animations?.length && !document.skins?.length, "Import a static scene without animation or skinning.");
  const scene = document.scenes?.[document.scene ?? 0];
  const metadata = scene?.extras?.pokeweb;
  check(metadata, "Export again from Pokeweb, then enable Include → Custom Properties when exporting GLB from Blender.");
  check(Array.isArray(metadata.sourceOrigin) && metadata.sourceOrigin.length === 3 && metadata.sourceOrigin.every(Number.isFinite)
    && metadata.scaleFromSource === 1 / 16, "Missing or invalid Pokeweb coordinate metadata.");
  check(Array.isArray(scene.nodes), "The GLB scene has no root nodes.");
  const bin = new DataView(binary.buffer, binary.byteOffset, document.buffers[0].byteLength);
  function accessor(index: number, expected: number | number[]): { values: number[]; count: number; width: number } {
    check(Number.isInteger(index), "Missing GLB accessor.");
    const a = document.accessors?.[index];
    const b = document.bufferViews?.[a?.bufferView];
    check(a && b && !a.sparse && (b.buffer ?? 0) === 0, "Sparse or external GLB accessors are unsupported.");
    const width = ({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 } as Record<string, number>)[a.type];
    const size = ({ 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 } as Record<number, number>)[a.componentType];
    check((Array.isArray(expected) ? expected : [expected]).includes(width) && size, "Unsupported GLB attribute layout.");
    check(Number.isSafeInteger(a.count) && a.count > 0 && a.count <= 65536, "Invalid or excessive vertex count.");
    const stride = b.byteStride ?? width * size, relative = a.byteOffset ?? 0, start = (b.byteOffset ?? 0) + relative;
    check([b.byteOffset ?? 0, b.byteLength, relative, stride].every(Number.isSafeInteger) && (b.byteOffset ?? 0) >= 0 && relative >= 0
      && stride >= width * size && stride % size === 0 && start % size === 0 && b.byteLength >= 0
      && (b.byteOffset ?? 0) + b.byteLength <= bin.byteLength && relative + (a.count - 1) * stride + width * size <= b.byteLength, "GLB accessor exceeds its buffer.");
    const values: number[] = [];
    for (let i = 0; i < a.count; i++) for (let c = 0; c < width; c++) {
      const offset = start + i * stride + c * size;
      let value = a.componentType === 5126 ? bin.getFloat32(offset, true)
        : a.componentType === 5125 ? bin.getUint32(offset, true)
        : a.componentType === 5123 ? bin.getUint16(offset, true)
        : a.componentType === 5122 ? bin.getInt16(offset, true)
        : a.componentType === 5121 ? bin.getUint8(offset) : bin.getInt8(offset);
      if (a.normalized) {
        check(a.componentType !== 5126 && a.componentType !== 5125, "Invalid normalized accessor.");
        value = Math.max(-1, value / ({ 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 } as Record<number, number>)[a.componentType]);
      }
      check(Number.isFinite(value), "GLB contains non-finite vertex data."); values.push(value);
    }
    return { values, count: a.count, width };
  }
  const visited = new Set<number>();
  let triangles = 0;
  function visit(index: number, parent: Matrix4, depth: number): StaticGlbNode {
    check(Number.isInteger(index) && depth < 128 && !visited.has(index), "Invalid, repeated, or cyclic GLB nodes.");
    visited.add(index);
    const node = document.nodes?.[index];
    check(node && node.skin === undefined && !node.extensions?.EXT_mesh_gpu_instancing, "Unsupported GLB node.");
    function vector(value: unknown, fallback: number[], length: number): number[] {
      const array = value ?? fallback;
      check(Array.isArray(array) && array.length === length && array.every(Number.isFinite), "Invalid object transform."); return array;
    }
    const local = node.matrix ? new Matrix4().fromArray(vector(node.matrix, [], 16)) : new Matrix4().compose(
      new Vector3().fromArray(vector(node.translation, [0, 0, 0], 3)),
      new Quaternion().fromArray(vector(node.rotation, [0, 0, 0, 1], 4)).normalize(),
      new Vector3().fromArray(vector(node.scale, [1, 1, 1], 3)));
    const world = parent.clone().multiply(local);
    check(Math.abs(world.determinant()) > 1e-12 && world.elements.every(Number.isFinite)
      && Math.abs(world.elements[3]) < 1e-8 && Math.abs(world.elements[7]) < 1e-8 && Math.abs(world.elements[11]) < 1e-8 && Math.abs(world.elements[15] - 1) < 1e-8, "Object has a zero-scale or invalid transform.");
    const meshes: StaticModelMesh[] = [];
    if (node.mesh !== undefined) {
      const mesh = document.meshes?.[node.mesh]; check(mesh?.primitives?.length, "Missing GLB mesh.");
      for (const primitive of mesh.primitives) {
        check((primitive.mode ?? 4) === 4 && !primitive.targets?.length && !primitive.extensions?.KHR_draco_mesh_compression, "Only static triangle meshes are supported.");
        const p = accessor(primitive.attributes?.POSITION, 3);
        const attribute = (name: string, width: number | number[]) => {
          const id = primitive.attributes?.[name]; if (id === undefined) return undefined;
          const a = accessor(id, width); check(a.count === p.count, "Mismatched GLB attribute counts."); return a;
        };
        const uv = attribute("TEXCOORD_0", 2), color = attribute("COLOR_0", [3, 4]), normal = attribute("NORMAL", 3);
        const ids = primitive.indices === undefined ? Array.from({ length: p.count }, (_, i) => i) : accessor(primitive.indices, 1).values;
        check(ids.length % 3 === 0 && ids.every(i => Number.isInteger(i) && i >= 0 && i < p.count), "Invalid triangle indices.");
        triangles += ids.length / 3; check(triangles <= triangleLimit, `The GLB exceeds the ${triangleLimit.toLocaleString()} triangle import limit.`);
        const material = document.materials?.[primitive.material];
        const materialName = material?.extras?.pokewebNativeMaterial ?? material?.name;
        check(typeof materialName === "string" && materialName.length > 0, "Keep the original building material assignments.");
        const positions = new Float32Array(p.values);
        const normals = normal ? new Float32Array(normal.values) : undefined;
        const colors = color ? new Float32Array(p.values.length) : undefined;
        for (let i = 0; i < p.count; i++) {
          if (color) {
            check(color.width !== 4 || Math.abs(color.values[i * 4 + 3] - 1) < 1e-6, "Per-vertex alpha cannot be imported into the existing DS materials.");
            colors!.set(color.values.slice(i * color.width, i * color.width + 3), i * 3);
          }
        }
        meshes.push({ materialName, materialIndex: primitive.material, positions, indices: new Uint32Array(ids), uvs: uv && new Float32Array(uv.values), colors, normals });
      }
    }
    return { index, world, extras: node.extras ?? {}, meshes, children: (node.children ?? []).map((child: number) => visit(child, world, depth + 1)) };
  }
  return { metadata, nodes: scene.nodes.map((node: number) => visit(node, new Matrix4(), 0)), document, binary };
}

export function transformStaticMeshes(meshes: StaticModelMesh[], matrix: Matrix4): StaticModelMesh[] {
  const normalMatrix = new Matrix3().getNormalMatrix(matrix);
  return meshes.map(mesh => {
    const positions = mesh.positions.slice(), normals = mesh.normals?.slice(), indices = mesh.indices.slice();
    for (let i = 0; i < positions.length; i += 3) {
      new Vector3().fromArray(positions, i).applyMatrix4(matrix).toArray(positions, i);
      if (normals) new Vector3().fromArray(normals, i).applyNormalMatrix(normalMatrix).toArray(normals, i);
    }
    if (matrix.determinant() < 0) for (let i = 0; i < indices.length; i += 3) [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
    return { ...mesh, positions, normals, indices };
  });
}

export function readBuildingGlb(bytes: Uint8Array): { metadata: BuildingGlbMetadata; meshes: StaticModelMesh[] } {
  const { metadata, nodes } = readStaticGlb(bytes, 4096);
  check(metadata.buildingImportVersion === 1 && metadata.content === "Static building model", "Export this building again from Pokeweb, then enable Include → Custom Properties when exporting GLB from Blender.");
  const native = new Matrix4().makeTranslation(...metadata.sourceOrigin as [number, number, number]).scale(new Vector3().setScalar(1 / metadata.scaleFromSource));
  const meshes: StaticModelMesh[] = [];
  function visit(node: StaticGlbNode) {
    meshes.push(...transformStaticMeshes(node.meshes, native.clone().multiply(node.world)));
    node.children.forEach(visit);
  }
  nodes.forEach(visit);
  check(meshes.length, "The GLB contains no building meshes.");
  return { metadata, meshes };
}
