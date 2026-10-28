import type { StudioMaterial } from "./mapStudioFormats";
import type { StudioMesh } from "./mapStudioModel";
import { compileStaticFaces } from "./nitroGeometryFaces";
import type { StaticModelMesh } from "./nitroModelWriter";

const rounded = (n: number) => Math.round(n * 10000) / 10000;
type Rectangle = { lo: number[]; hi: number[]; axes: number[]; axis: number; plane: number[]; uv: number[][]; color: number[]; positive: boolean; rotation: number[] };
/** Merge coplanar rectangles only when their UV mapping, colors and winding agree.
 * Repeated UVs may differ by whole texture periods; atlas boundaries stay separate.
 */
export function optimizeStudioMesh(mesh: StudioMesh, material: StudioMaterial, width = 8, height = 8): StudioMesh {
  const input: StaticModelMesh = { materialName: "studio", positions: new Float32Array(mesh.positions), uvs: new Float32Array(mesh.uvs), colors: new Float32Array(mesh.colors), indices: new Uint32Array(mesh.indices) };
  const out: StudioMesh = { material: mesh.material, positions: [], uvs: [], colors: [], indices: [] }, groups = new Map<string, Rectangle[]>();
  const emit = (positions: number[][], uvs: number[][], colors: number[][]) => {
    const base = out.positions.length / 3; out.positions.push(...positions.flat()); out.uvs.push(...uvs.flat()); out.colors.push(...colors.flat());
    for (let i = 1; i < positions.length - 1; i++) out.indices.push(base, base + i, base + i + 1);
  };
  for (const face of compileStaticFaces([input])) {
    const p = face.map(v => Array.from(v.mesh.positions.slice(v.index * 3, v.index * 3 + 3))), uv = face.map(v => Array.from(v.mesh.uvs!.slice(v.index * 2, v.index * 2 + 2))), colors = face.map(v => Array.from(v.mesh.colors!.slice(v.index * 3, v.index * 3 + 3)));
    const ab = p[1].map((n, i) => n - p[0][i]), ac = p[2].map((n, i) => n - p[0][i]);
    const normal = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    const axis = normal.map(Math.abs).indexOf(Math.max(...normal.map(Math.abs))), axes = [0, 1, 2].filter(n => n !== axis);
    const determinant = ab[axes[0]] * ac[axes[1]] - ab[axes[1]] * ac[axes[0]];
    if (Math.abs(determinant) > 1e-8) for (let channel = 0; channel < 2; channel++) {
      const repeat = [material.repeatU, material.repeatV][channel]; if (repeat === 1) continue;
      const a = ((uv[1][channel] - uv[0][channel]) * ac[axes[1]] - (uv[2][channel] - uv[0][channel]) * ab[axes[1]]) / determinant;
      const b = (ab[axes[0]] * (uv[2][channel] - uv[0][channel]) - ac[axes[0]] * (uv[1][channel] - uv[0][channel])) / determinant;
      const c = uv[0][channel] - a * p[0][axes[0]] - b * p[0][axes[1]], period = repeat === 2 ? 2 : 1;
      const phase = rounded(((c % period) + period) % period) % period, shift = Math.round((c - phase) / period) * period;
      const size = (channel ? height : width) * (repeat === 2 ? 2 : 1);
      if (uv.every(v => Math.abs((channel ? 1 - v[channel] + shift : v[channel] - shift) * size) < 2047)) uv.forEach(v => v[channel] -= shift);
    }
    const angle = ((Math.atan2(ab[axes[1]], ab[axes[0]]) % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);
    const rotation = [Math.cos(angle), Math.sin(angle)], [cos, sin] = rotation;
    const projected = p.map(v => [v[axes[0]] * cos + v[axes[1]] * sin, -v[axes[0]] * sin + v[axes[1]] * cos]);
    const lo = [0, 1].map(a => Math.min(...projected.map(v => v[a]))), hi = [0, 1].map(a => Math.max(...projected.map(v => v[a])));
    if (face.length !== 4 || Math.abs(normal[axis]) < 1e-8 || projected.some(v => v.some((n, i) => Math.abs(n - lo[i]) > 0.00001 && Math.abs(n - hi[i]) > 0.00001)) || colors.some(c => c.some((v, i) => v !== colors[0][i]))) { emit(p, uv, colors); continue; }
    const a = -normal[axes[0]] / normal[axis], b = -normal[axes[1]] / normal[axis];
    const plane = [a * cos + b * sin, -a * sin + b * cos, p[0][axis] - a * p[0][axes[0]] - b * p[0][axes[1]]];
    const dp = projected[1].map((n, i) => n - projected[0][i]), dq = projected[2].map((n, i) => n - projected[0][i]);
    const det = dp[0] * dq[1] - dp[1] * dq[0];
    const mapping = [0, 1].map(a => {
      const u = ((uv[1][a] - uv[0][a]) * dq[1] - (uv[2][a] - uv[0][a]) * dp[1]) / det;
      const v = (dp[0] * (uv[2][a] - uv[0][a]) - dq[0] * (uv[1][a] - uv[0][a])) / det;
      return [u, v, uv[0][a] - u * projected[0][0] - v * projected[0][1]];
    });
    if (mapping.some((m, a) => Math.abs(m[0] * projected[3][0] + m[1] * projected[3][1] + m[2] - uv[3][a]) > 0.00001)) { emit(p, uv, colors); continue; }
    const phase = mapping.map((m, i) => { const period = [material.repeatU, material.repeatV][i] === 1 ? 0 : [material.repeatU, material.repeatV][i] === 2 ? 2 : 1; return [rounded(m[0]), rounded(m[1]), period ? rounded(((m[2] % period) + period) % period) % period : rounded(m[2])]; });
    const key = JSON.stringify([axis, rounded(angle), normal[axis] > 0, plane.map(rounded), phase, colors[0]]), rectangles = groups.get(key) ?? [];
    rectangles.push({ lo: lo.map(rounded), hi: hi.map(rounded), axes, axis, plane, uv: mapping, color: colors[0], positive: normal[axis] > 0, rotation }); groups.set(key, rectangles);
  }
  for (let rectangles of groups.values()) {
    let changed = true;
    while (changed) {
      changed = false;
      for (let axis = 0; axis < 2; axis++) {
        const spans = new Map<string, Rectangle[]>();
        for (const r of rectangles) { const key = `${r.lo[1 - axis]},${r.hi[1 - axis]}`; const group = spans.get(key) ?? []; group.push(r); spans.set(key, group); }
        rectangles = [];
        for (const span of spans.values()) {
          span.sort((a, b) => a.lo[axis] - b.lo[axis]); let previous: Rectangle | undefined;
          for (const r of span) {
            if (previous && Math.abs(previous.hi[axis] - r.lo[axis]) < 0.00001) { previous.hi[axis] = r.hi[axis]; changed = true; }
            else { rectangles.push(r); previous = r; }
          }
        }
      }
    }
    for (const r of rectangles) {
      const corners = [[r.lo[0], r.lo[1]], [r.hi[0], r.lo[1]], [r.hi[0], r.hi[1]], [r.lo[0], r.hi[1]]];
      // Projection on X/Z reverses orientation; the other two projections preserve it.
      if (r.positive === (r.axis === 1)) corners.reverse();
      const positions = corners.map(([x, y]) => { const p = [0, 0, 0]; p[r.axes[0]] = x * r.rotation[0] - y * r.rotation[1]; p[r.axes[1]] = x * r.rotation[1] + y * r.rotation[0]; p[r.axis] = r.plane[0] * x + r.plane[1] * y + r.plane[2]; return p; });
      emit(positions, corners.map(([x, y]) => r.uv.map(m => m[0] * x + m[1] * y + m[2])), corners.map(() => r.color));
    }
  }
  return out;
}
