import type { StaticModelMesh } from "./nitroModelWriter";

type Triangle = { mesh: StaticModelMesh; ids: number[]; center: number[] };
function triangles(meshes: StaticModelMesh[]): Triangle[] {
  return meshes.flatMap(mesh => Array.from({ length: mesh.indices.length / 3 }, (_, i) => {
    const ids = Array.from(mesh.indices.slice(i * 3, i * 3 + 3));
    return { mesh, ids, center: [0, 1, 2].map(axis => ids.reduce((sum, id) => sum + mesh.positions[id * 3 + axis], 0) / 3) };
  }));
}

/** Compare triangle content, tolerating Blender's vertex splits, reordering and float drift.
 * Spatial buckets make matching independent of vertex/triangle order without a quadratic scan.
 */
export function sameStaticGeometry(source: StaticModelMesh[], edited: StaticModelMesh[]): boolean {
  const before = triangles(source), after = triangles(edited);
  if (before.length !== after.length) return false;
  const buckets = new Map<string, Triangle[]>();
  const key = (name: string, xyz: number[]) => `${name}:${xyz.join(",")}`;
  for (const triangle of before) {
    const id = key(triangle.mesh.materialName, triangle.center.map(v => Math.floor(v * 8)));
    const bucket = buckets.get(id) ?? []; bucket.push(triangle); buckets.set(id, bucket);
  }
  function matches(a: Triangle, b: Triangle): boolean {
    const edge = (end: number) => [0, 1, 2].map(axis => a.mesh.positions[a.ids[end] * 3 + axis] - a.mesh.positions[a.ids[0] * 3 + axis]);
    const u = edge(1), v = edge(2);
    const degenerate = Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) < 1e-8;
    function vertex(i: number, j: number) {
      for (let axis = 0; axis < 3; axis++) {
        if (Math.abs(a.mesh.positions[i * 3 + axis] - b.mesh.positions[j * 3 + axis]) > 0.002) return false;
        if (Math.abs((a.mesh.colors?.[i * 3 + axis] ?? 1) - (b.mesh.colors?.[j * 3 + axis] ?? 1)) > 0.004) return false;
      }
      if (a.mesh.uvs) {
        if (!b.mesh.uvs) return false;
        for (let axis = 0; axis < 2; axis++) if (Math.abs(a.mesh.uvs[i * 2 + axis] - b.mesh.uvs[j * 2 + axis]) > 0.0001) return false;
      }
      // Blender can regenerate arbitrary normals on zero-area faces. They draw no pixels.
      if (a.mesh.normals && !a.mesh.colors && !degenerate) {
        if (!b.mesh.normals) return false;
        const av = a.mesh.normals.slice(i * 3, i * 3 + 3), bv = b.mesh.normals.slice(j * 3, j * 3 + 3);
        const al = Math.hypot(...av) || 1, bl = Math.hypot(...bv) || 1;
        for (let axis = 0; axis < 3; axis++) if (Math.abs(av[axis] / al - bv[axis] / bl) > 0.004) return false;
      }
      return true;
    }
    // Cyclic permutations preserve winding; reversing a triangle is a real edit.
    return [0, 1, 2].some(shift => a.ids.every((id, i) => vertex(id, b.ids[(i + shift) % 3])));
  }
  for (const triangle of after) {
    const cell = triangle.center.map(v => Math.floor(v * 8));
    let matched = false;
    search: for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
      const bucket = buckets.get(key(triangle.mesh.materialName, [cell[0] + x, cell[1] + y, cell[2] + z]));
      const index = bucket?.findIndex(candidate => matches(candidate, triangle)) ?? -1;
      if (index >= 0) { bucket!.splice(index, 1); matched = true; break search; }
    }
    if (!matched) return false;
  }
  return true;
}
