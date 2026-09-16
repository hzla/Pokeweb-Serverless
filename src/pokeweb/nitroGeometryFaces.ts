import type { StaticModelMesh } from "./nitroModelWriter";

export type StaticVertex = { mesh: StaticModelMesh; index: number };

/** Restore convex, planar quads split by glTF. This avoids doubling DS polygon usage. */
export function compileStaticFaces(meshes: StaticModelMesh[]): StaticVertex[][] {
  const vertices = new Map<string, number>();
  const triangles: { vertices: StaticVertex[]; ids: number[] }[] = [];
  for (const mesh of meshes) for (let i = 0; i < mesh.indices.length; i += 3) {
    const face = Array.from(mesh.indices.slice(i, i + 3)).map(index => ({ mesh, index }));
    const ids = face.map(({ mesh, index }) => {
      const key = [mesh.positions.slice(index * 3, index * 3 + 3), mesh.uvs?.slice(index * 2, index * 2 + 2),
        mesh.colors?.slice(index * 3, index * 3 + 3), mesh.normals?.slice(index * 3, index * 3 + 3)].map(v => v ? Array.from(v).join(",") : "-").join(";");
      if (!vertices.has(key)) vertices.set(key, vertices.size);
      return vertices.get(key)!;
    });
    triangles.push({ vertices: face, ids });
  }
  const edgeKey = (a: number, b: number) => `${a}:${b}`;
  const edges = new Map<string, number[]>();
  triangles.forEach((triangle, i) => triangle.ids.forEach((a, j) => {
    const key = edgeKey(a, triangle.ids[(j + 1) % 3]);
    const bucket = edges.get(key) ?? []; bucket.push(i); edges.set(key, bucket);
  }));
  const used = new Set<number>();
  const result: StaticVertex[][] = [];
  const point = (v: StaticVertex) => Array.from(v.mesh.positions.slice(v.index * 3, v.index * 3 + 3));
  const sub = (a: number[], b: number[]) => a.map((v, i) => v - b[i]);
  const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a: number[], b: number[]) => a.reduce((sum, v, i) => sum + v * b[i], 0);
  function isQuad(face: StaticVertex[]) {
    const p = face.map(point), normal = cross(sub(p[1], p[0]), sub(p[2], p[0])), length = Math.hypot(...normal);
    if (length < 1e-8 || Math.abs(dot(normal, sub(p[3], p[0]))) / length > 0.001) return false;
    // All four turns must face the same way; reject concave and degenerate quads.
    return p.every((v, i) => dot(cross(sub(p[(i + 1) % 4], v), sub(p[(i + 2) % 4], p[(i + 1) % 4])), normal) > 1e-8);
  }
  triangles.forEach((triangle, i) => {
    if (used.has(i)) return;
    used.add(i);
    let face = triangle.vertices;
    search: for (let edge = 0; edge < 3; edge++) {
      const a = triangle.ids[edge], b = triangle.ids[(edge + 1) % 3];
      for (const candidate of edges.get(edgeKey(b, a)) ?? []) {
        if (used.has(candidate)) continue;
        const other = triangles[candidate];
        const opposite = other.ids.findIndex(id => id !== a && id !== b);
        if (opposite < 0) continue;
        const quad = [triangle.vertices[(edge + 1) % 3], triangle.vertices[(edge + 2) % 3], triangle.vertices[edge], other.vertices[opposite]];
        if (!isQuad(quad)) continue;
        used.add(candidate); face = quad; break search;
      }
    }
    result.push(face);
  });
  return result;
}
