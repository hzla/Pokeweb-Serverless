/** Walking surfaces use tile units; native terrain models use 16 units per tile. */
export const MAP_HEIGHT_SNAP = 1 / 16;
export type HeightPlate = { x0: number; y0: number; x1: number; y1: number; a: number; b: number; c: number };
export type HeightMesh = { positions: ArrayLike<number>; indices: ArrayLike<number> };
type Triangle = { points: number[][]; a: number; b: number; c: number; key: string };
const snap = (n: number) => Math.round(n / MAP_HEIGHT_SNAP) * MAP_HEIGHT_SNAP;
const height = (p: Pick<HeightPlate, "a" | "b" | "c">, x: number, y: number) => p.a * x + p.b * y + p.c;
function contains(t: Triangle, x: number, y: number) {
  const [p, q, r] = t.points;
  const d = (q[2] - r[2]) * (p[0] - r[0]) + (r[0] - q[0]) * (p[2] - r[2]);
  const u = ((q[2] - r[2]) * (x - r[0]) + (r[0] - q[0]) * (y - r[2])) / d;
  const v = ((r[2] - p[2]) * (x - r[0]) + (p[0] - r[0]) * (y - r[2])) / d;
  return u >= -1e-7 && v >= -1e-7 && u + v <= 1 + 1e-7;
}

/** Geometry and collision only: existing height files are deliberately not an input. */
export function generateMapHeightPlates(meshes: HeightMesh[], walkable: boolean[]) {
  if (walkable.length !== 1024) throw new Error("Walking height generation requires a 32 × 32 collision grid.");
  const bins: Triangle[][] = Array.from({ length: 1024 }, () => []);
  for (const mesh of meshes) for (let f = 0; f + 2 < mesh.indices.length; f += 3) {
    const points = [0, 1, 2].map(i => [0, 1, 2].map(axis => mesh.positions[mesh.indices[f + i] * 3 + axis] / 16));
    if (points.some(p => p.some(n => !Number.isFinite(n)))) throw new Error("Terrain contains invalid coordinates.");
    const [p, q, r] = points, ux = q[0] - p[0], uy = q[1] - p[1], uz = q[2] - p[2], vx = r[0] - p[0], vy = r[1] - p[1], vz = r[2] - p[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (Math.abs(ny) < 1e-8) continue; // Walls and degenerate projected faces are not walking surfaces.
    const a = -nx / ny, b = -nz / ny, c = p[1] - a * p[0] - b * p[2];
    if (Math.abs(a) > 4 || Math.abs(b) > 4) continue;
    const key = [a, b, c].map(n => Math.round(n * 1e5)).join(":"), t = { points, a, b, c, key };
    const minX = Math.max(0, Math.floor(Math.min(...points.map(p => p[0])) + 16)), maxX = Math.min(31, Math.ceil(Math.max(...points.map(p => p[0])) + 16) - 1);
    const minY = Math.max(0, Math.floor(Math.min(...points.map(p => p[2])) + 16)), maxY = Math.min(31, Math.ceil(Math.max(...points.map(p => p[2])) + 16) - 1);
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) if (walkable[y * 32 + x]) bins[y * 32 + x].push(t);
  }
  const masks = new Map<string, { plane: Pick<HeightPlate, "a" | "b" | "c">; cells: Set<number> }>();
  const missing: number[] = [];
  for (let i = 0; i < 1024; i++) {
    if (!walkable[i]) continue;
    const groups = new Map<string, Triangle[]>();
    for (const t of bins[i]) { const list = groups.get(t.key) || []; list.push(t); groups.set(t.key, list); }
    const x = i % 32 - 16, y = Math.floor(i / 32) - 16; let found = false;
    for (const triangles of groups.values()) {
      // Require support over the entire tile; do not turn roofs, slivers or holes into ground.
      if (![0.001, 0.5, 0.999].every(dx => [0.001, 0.5, 0.999].every(dy => triangles.some(t => contains(t, x + dx, y + dy))))) continue;
      const t = triangles[0], z = snap(height(t, x, y)), a = snap(height(t, x + 1, y)) - z, b = snap(height(t, x, y + 1)) - z, c = z - a * x - b * y;
      if (Math.abs(height(t, x + 1, y + 1) - (z + a + b)) > MAP_HEIGHT_SNAP / 2 + 1e-6) continue;
      const key = [a, b, c].join(":"), entry = masks.get(key) || { plane: { a, b, c }, cells: new Set<number>() };
      entry.cells.add(i); masks.set(key, entry); found = true;
    }
    if (!found) missing.push(i);
  }
  const plates: HeightPlate[] = [];
  for (const { plane, cells } of masks.values()) for (let i = 0; i < 1024; i++) {
    if (!cells.has(i)) continue;
    const x = i % 32, y = Math.floor(i / 32); let width = 1, depth = 1;
    while (x + width < 32 && cells.has(i + width)) width++;
    while (y + depth < 32 && Array.from({ length: width }, (_, dx) => i + depth * 32 + dx).every(n => cells.has(n))) depth++;
    for (let dy = 0; dy < depth; dy++) for (let dx = 0; dx < width; dx++) cells.delete(i + dy * 32 + dx);
    plates.push({ x0: x - 16, y0: y - 16, x1: x + width - 16, y1: y + depth - 16, ...plane });
  }
  return { plates, missing, walkable: walkable.filter(Boolean).length };
}

export function sampleMapHeightPlates(plates: HeightPlate[], x: number, y: number) {
  return [...new Set(plates.filter(p => x >= p.x0 && x < p.x1 && y >= p.y0 && y < p.y1).map(p => height(p, x, y)))].sort((a, b) => a - b);
}
export function compareMapHeightPlates(original: HeightPlate[], generated: HeightPlate[], walkable: boolean[], tolerance = MAP_HEIGHT_SNAP / 2) {
  let samples = 0, mismatches = 0, maxError = 0; const changedTiles = new Set<number>();
  for (let i = 0; i < 1024; i++) if (walkable[i]) for (const dx of [0.125, 0.5, 0.875]) for (const dy of [0.125, 0.5, 0.875]) {
    samples++; const x = i % 32 - 16 + dx, y = Math.floor(i / 32) - 16 + dy, before = sampleMapHeightPlates(original, x, y), after = sampleMapHeightPlates(generated, x, y);
    const error = before.length !== after.length ? Infinity : Math.max(0, ...before.map((z, n) => Math.abs(z - after[n])));
    maxError = Math.max(maxError, error); if (error > tolerance + 1e-6) { mismatches++; changedTiles.add(i); }
  }
  return { samples, mismatches, changedTiles: [...changedTiles], maxError, equivalent: mismatches === 0 };
}
