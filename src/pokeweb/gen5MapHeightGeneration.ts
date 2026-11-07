import { readU16, writeU16 } from "../nds/binary";
import { validateGen5Permissions } from "./gen5MapImportFormats";
import { distances, slopesX, slopesY } from "./mapStudioHeightTables";
import { generateMapHeightPlates, MAP_HEIGHT_SNAP, type HeightMesh, type HeightPlate } from "./mapHeightGeometry";

type Game = "BW" | "BW2";
export function gen5WalkableTiles(per: Uint8Array) {
  validateGen5Permissions(per);
  return Array.from({ length: 1024 }, (_, i) => !(readU16(per, 10 + i * 8) & 1) && ![1, 18].includes(readU16(per, 8 + i * 8)));
}
const tables = new Map<Game, { sx: number[]; sy: number[]; ds: number[]; sorted: { value: number; index: number }[]; slopes: Map<string, number> }>();
function table(game: Game) {
  let value = tables.get(game);
  if (!value) { const i = game === "BW" ? 0 : 1; value = { sx: slopesX[i], sy: slopesY[i], ds: distances[i], sorted: distances[i].map((value, index) => ({ value, index })).sort((a,b) => a.value-b.value), slopes: new Map() }; tables.set(game, value); }
  return value;
}
/** Decode native planes independently of the generation geometry. */
export function gen5HeightAt(per: Uint8Array, index: number, dx: number, dy: number, game: Game): number {
  const { sx, sy, ds } = table(game), at = 4 + index * 8, first = readU16(per, at), distance = readU16(per, at + 2), x = index % 32 - 16, y = Math.floor(index / 32) - 16;
  const plane = (s: number, d: number, u: number, v: number) => {
    if (sx[s] === undefined || ds[d] === undefined) throw new Error(`Unknown ${game} walking plane at tile ${index % 32}, ${Math.floor(index / 32)}.`);
    return sx[s] * (x + u) + sy[s] * (y + v) + ds[d] * Math.hypot(sx[s], sy[s], 1);
  };
  if ((first & 3) !== 2) return plane(first >>> 2, distance, dx, dy);
  const corner = 8196 + distance * 8;
  if (corner + 8 > per.length) throw new Error("Missing collision corner record.");
  const s1 = (readU16(per, corner) - 1) / 4, s2 = readU16(per, corner + 2), d1 = readU16(per, corner + 4), d2 = readU16(per, corner + 6);
  const z = [plane(s1, d1, 0, 0), plane(s1, d1, 1, 0), plane(s2, d2, 1, 1), plane(s2, d2, 0, 1)];
  if (Math.abs(z[0] - z[2]) > Math.abs(z[1] - z[3])) return dx >= dy ? z[0] + (z[1] - z[0]) * dx + (z[2] - z[1]) * dy : z[0] + (z[2] - z[3]) * dx + (z[3] - z[0]) * dy;
  return dx + dy <= 1 ? z[0] + (z[1] - z[0]) * dx + (z[3] - z[0]) * dy : z[2] + (z[3] - z[2]) * (1 - dx) + (z[1] - z[2]) * (1 - dy);
}

function encodePlane(plate: HeightPlate, index: number, game: Game) {
  const { sx, sy, ds, sorted, slopes } = table(game), x = index % 32 - 16, y = Math.floor(index / 32) - 16, key = `${plate.a}:${plate.b}`;
  let slope = slopes.get(key) ?? 0;
  if (!slopes.has(key)) { for (let s = 1; s < sx.length; s++) if ((sx[s] - plate.a) ** 2 + (sy[s] - plate.b) ** 2 < (sx[slope] - plate.a) ** 2 + (sy[slope] - plate.b) ** 2) slope = s; slopes.set(key, slope); }
  const norm = Math.hypot(sx[slope], sy[slope], 1), middle = plate.a * (x + .5) + plate.b * (y + .5) + plate.c;
  const target = (middle - sx[slope] * (x + .5) - sy[slope] * (y + .5)) / norm;
  let lo = 0, hi = sorted.length - 1; while (lo < hi) { const mid = (lo + hi) >>> 1; if (sorted[mid].value < target) lo = mid + 1; else hi = mid; }
  const distance = lo > 0 && Math.abs(sorted[lo - 1].value - target) <= Math.abs(sorted[lo].value - target) ? sorted[lo - 1].index : sorted[lo].index;
  const error = Math.max(...[0, 1].flatMap(dx => [0, 1].map(dy => Math.abs(sx[slope] * (x + dx) + sy[slope] * (y + dy) + ds[distance] * norm - (plate.a * (x + dx) + plate.b * (y + dy) + plate.c)))));
  return { slope, distance, error };
}

export function generateGen5MapHeights(meshes: HeightMesh[], primary: Uint8Array, secondary: Uint8Array | undefined, game: Game) {
  const walkable = gen5WalkableTiles(primary), secondWalkable = secondary ? gen5WalkableTiles(secondary) : Array(1024).fill(false) as boolean[];
  const union = walkable.map((yes, i) => yes || secondWalkable[i]);
  const result = generateMapHeightPlates(meshes, union), original = [primary, secondary], output = [primary.slice(), secondary?.slice()];
  const unsupported = new Set<number>(), changed = new Set<number>(), extraSurfaces = new Set<number>();
  let samples = 0, matchingSamples = 0, maxDifference = 0, maxEncodingError = 0;
  for (let index = 0; index < 1024; index++) {
    if (!union[index]) continue;
    const x = index % 32 - 15.5, y = Math.floor(index / 32) - 15.5;
    const candidates = result.plates.filter(p => x >= p.x0 && x < p.x1 && y >= p.y0 && y < p.y1).sort((p, q) => (q.a - p.a) * x + (q.b - p.b) * y + q.c - p.c);
    if (candidates.length > (secondary ? 2 : 1)) extraSurfaces.add(index);
    for (let layer = 0; layer < output.length; layer++) {
      const out = output[layer], source = original[layer]; if (!out || !source || !(layer ? secondWalkable : walkable)[index]) continue;
      const plate = candidates[layer && candidates.length > 1 ? 1 : 0]; if (!plate) continue;
      const encoded = encodePlane(plate, index, game); maxEncodingError = Math.max(maxEncodingError, encoded.error);
      if (encoded.error > MAP_HEIGHT_SNAP / 2 + 1e-4) { unsupported.add(index); continue; }
      writeU16(out, 4 + index * 8, encoded.slope * 4); writeU16(out, 6 + index * 8, encoded.distance);
      for (const dx of [.125, .5, .875]) for (const dy of [.125, .5, .875]) {
        samples++;
        try {
          const delta = Math.abs(gen5HeightAt(source, index, dx, dy, game) - gen5HeightAt(out, index, dx, dy, game));
          maxDifference = Math.max(maxDifference, delta); if (delta <= MAP_HEIGHT_SNAP / 2 + 1e-4) matchingSamples++; else changed.add(index);
        } catch { changed.add(index); maxDifference = Infinity; }
      }
    }
  }
  return { ...result, primary: output[0]!, secondary: output[1], unsupported: [...unsupported], extraSurfaces: [...extraSurfaces], changedTiles: [...changed], samples, matchingSamples, maxDifference, maxEncodingError,
    equivalent: samples > 0 && matchingSamples === samples && !result.missing.length && !unsupported.size && !extraSurfaces.size,
    canApply: result.walkable > 0 && !result.missing.length && !unsupported.size && !extraSurfaces.size };
}

export function gen5HeightPreview(plates: HeightPlate[]) {
  const positions: number[] = [], indices: number[] = [];
  for (const p of plates) {
    const at = positions.length / 3;
    for (const [x, y] of [[p.x0,p.y0],[p.x1,p.y0],[p.x1,p.y1],[p.x0,p.y1]]) positions.push(x * 16, (p.a * x + p.b * y + p.c) * 16 + .2, y * 16);
    indices.push(at,at+1,at+2,at,at+2,at+3);
  }
  return { positions: new Float32Array(positions), indices: new Uint16Array(indices) };
}
