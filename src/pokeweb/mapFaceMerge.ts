import type { BrushVertex } from "./mapBrushGeometry";

/**
 * Merging map brush faces. A brush builds its art tile by tile; neighbouring faces that lie in one plane, light the
 * same and continue each other's texture are joined into one triangle or quad, as the game's own maps draw long
 * fences and grass, so edits cost about as many polygons as the game's own art.
 */

const s16 = (value: number) => (value << 16) >> 16;

const EPSILON = 1e-3;
type Vec3 = readonly [number, number, number];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const length = (a: Vec3) => Math.sqrt(dot(a, a));
const samePosition = (a: Vec3, b: Vec3) => Math.abs(a[0] - b[0]) < EPSILON && Math.abs(a[1] - b[1]) < EPSILON && Math.abs(a[2] - b[2]) < EPSILON;
const uv = (vertex: BrushVertex): [number, number] | undefined => vertex.texcoord === undefined ? undefined : [s16(vertex.texcoord), s16(vertex.texcoord >>> 16)];

/** Texture coordinates within a sixteenth of a texel: what clipping a long face at a tile edge can leave apart. */
function sameTexcoord(a: BrushVertex, b: BrushVertex) {
  const p = uv(a), q = uv(b);
  return !p || !q ? p === q : Math.abs(p[0] - q[0]) <= 1 && Math.abs(p[1] - q[1]) <= 1;
}

/** Normal, colour and attribute order the same at every vertex, so a merged face lights exactly as its parts did. */
function lighting(face: readonly BrushVertex[]) {
  const [first] = face;
  if (face.some(vertex => vertex.normal !== first.normal || vertex.color !== first.color || vertex.normalLast !== first.normalLast
    || (vertex.texcoord === undefined) !== (first.texcoord === undefined))) return undefined;
  return `${first.normal}|${first.color}|${first.normalLast}|${first.texcoord === undefined}`;
}

function faceNormal(face: readonly BrushVertex[]): Vec3 | undefined {
  let normal: Vec3 = [0, 0, 0];
  for (let i = 0; i < face.length; i++) {
    const a = face[i].position, b = face[(i + 1) % face.length].position;
    normal = [normal[0] + (a[1] - b[1]) * (a[2] + b[2]), normal[1] + (a[2] - b[2]) * (a[0] + b[0]), normal[2] + (a[0] - b[0]) * (a[1] + b[1])];
  }
  const size = length(normal);
  return size > EPSILON ? [normal[0] / size, normal[1] / size, normal[2] / size] : undefined;
}

/**
 * Whether a planar polygon is convex, and its texture coordinates are one affine map of position (so the GPU's
 * interpolation across it draws exactly what its parts drew).
 */
function drawsTheSame(face: readonly BrushVertex[], normal: Vec3) {
  const n = face.length;
  for (let i = 0; i < n; i++) {
    const a = face[i].position, b = face[(i + 1) % n].position, c = face[(i + 2) % n].position;
    if (dot(cross(sub(b, a), sub(c, b)), normal) <= EPSILON) return false;
  }
  if (face[0].texcoord === undefined) return true;
  // Plane coordinates from the first edge, then the affine map from the first three vertices.
  const origin = face[0].position, xAxis = sub(face[1].position, origin);
  const unitX: Vec3 = [xAxis[0] / length(xAxis), xAxis[1] / length(xAxis), xAxis[2] / length(xAxis)];
  const unitY = cross(normal, unitX);
  const flat = face.map(vertex => { const d = sub(vertex.position, origin); return [dot(d, unitX), dot(d, unitY)] as const; });
  const coords = face.map(vertex => uv(vertex)!);
  const [p0, p1, p2] = flat, [t0, t1, t2] = coords;
  const det = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (p1[1] - p0[1]);
  if (Math.abs(det) < EPSILON) return false;
  for (let i = 3; i < n; i++) {
    const p = flat[i];
    const alpha = ((p[0] - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (p[1] - p0[1])) / det;
    const beta = ((p1[0] - p0[0]) * (p[1] - p0[1]) - (p[0] - p0[0]) * (p1[1] - p0[1])) / det;
    for (const axis of [0, 1]) {
      const expected = t0[axis] + alpha * (t1[axis] - t0[axis]) + beta * (t2[axis] - t0[axis]);
      if (Math.abs(expected - coords[i][axis]) > 0.5) return false;
    }
  }
  return true;
}

/** Drop vertices that sit on a straight edge between their neighbours, where texture coordinates also run straight. */
function dropStraightVertices(face: BrushVertex[]) {
  let changed = true;
  while (changed && face.length > 3) {
    changed = false;
    for (let i = 0; i < face.length; i++) {
      const before = face[(i + face.length - 1) % face.length], vertex = face[i], after = face[(i + 1) % face.length];
      const span = sub(after.position, before.position), part = sub(vertex.position, before.position);
      if (length(cross(span, part)) > EPSILON * Math.max(1, length(span))) continue;
      const t = dot(part, span) / dot(span, span);
      if (t <= 0 || t >= 1) continue;
      const a = uv(before), b = uv(vertex), c = uv(after);
      if (a && b && c && [0, 1].some(axis => Math.abs(a[axis] + t * (c[axis] - a[axis]) - b[axis]) > 0.5)) continue;
      face.splice(i, 1);
      changed = true;
      break;
    }
  }
  return face;
}

/** Join two faces across a shared edge into one triangle or quad, if it draws the same. */
function joinFaces(a: readonly BrushVertex[], b: readonly BrushVertex[], normal: Vec3): BrushVertex[] | undefined {
  for (let i = 0; i < a.length; i++) {
    const a0 = a[i], a1 = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j++) {
      const b0 = b[j], b1 = b[(j + 1) % b.length];
      // The shared edge runs the other way round the second face; texture coordinates must match across it.
      if (!samePosition(a0.position, b1.position) || !samePosition(a1.position, b0.position)
        || !sameTexcoord(a0, b1) || !sameTexcoord(a1, b0)) continue;
      const joined: BrushVertex[] = [];
      for (let k = 0; k < a.length; k++) joined.push(a[(i + 1 + k) % a.length]);
      for (let k = 1; k < b.length - 1; k++) joined.push(b[(j + 1 + k) % b.length]);
      const face = dropStraightVertices(joined);
      return face.length <= 4 && drawsTheSame(face, normal) ? face : undefined;
    }
  }
  return undefined;
}

/**
 * Fewer polygons for the same picture: neighbouring faces that lie in one plane, light the same and continue each
 * other's texture are joined into one triangle or quad, as the game's own maps draw long fences and grass. Faces
 * that can't be joined are kept as they are.
 */
export function mergeBrushFaces(faces: readonly (readonly BrushVertex[])[]): BrushVertex[][] {
  type Entry = { face: BrushVertex[]; normal?: Vec3; key?: string; alive: boolean };
  const entries: Entry[] = faces.map(face => {
    const normal = face.length >= 3 ? faceNormal(face) : undefined;
    const light = lighting(face);
    const planar = normal && face.every(vertex => Math.abs(dot(sub(vertex.position, face[0].position), normal)) < 0.01);
    return { face: [...face], normal, key: planar && light ? light : undefined, alive: true };
  });
  const edgeKey = (a: Vec3, b: Vec3) => {
    const round = (p: Vec3) => p.map(n => Math.round(n * 64)).join(",");
    const [x, y] = [round(a), round(b)];
    return x < y ? `${x}|${y}` : `${y}|${x}`;
  };
  let merged = true;
  while (merged) {
    merged = false;
    const byEdge = new Map<string, Entry[]>();
    for (const entry of entries) {
      if (!entry.alive || !entry.key) continue;
      for (let i = 0; i < entry.face.length; i++) {
        const key = edgeKey(entry.face[i].position, entry.face[(i + 1) % entry.face.length].position);
        const list = byEdge.get(key);
        if (list) list.push(entry);
        else byEdge.set(key, [entry]);
      }
    }
    for (const entry of entries) {
      if (!entry.alive || !entry.key) continue;
      // One join per face per pass; the edge index is rebuilt for the next pass.
      let joinedHere = false;
      for (let i = 0; i < entry.face.length && !joinedHere; i++) {
        const key = edgeKey(entry.face[i].position, entry.face[(i + 1) % entry.face.length].position);
        for (const other of byEdge.get(key) ?? []) {
          if (other === entry || !other.alive || other.key !== entry.key || dot(other.normal!, entry.normal!) < 1 - 1e-6) continue;
          const joined = joinFaces(entry.face, other.face, entry.normal!);
          if (!joined) continue;
          entry.face = joined;
          other.alive = false;
          merged = joinedHere = true;
          break;
        }
      }
    }
  }
  return entries.filter(entry => entry.alive).map(entry => entry.face);
}

