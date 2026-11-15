import { readU16 } from "../nds/binary";
import { recordGenericChange } from "./actionChangelog";
import { equalMapBytes, readGen5MapBin } from "./gen5MapImportFormats";
import type { Gen5PermissionTileLike } from "./gen5PermissionModel";
import { packGameFreakContainer, type Map3dSceneData, type Map3dTile } from "./map3dModel";
import { countDisplayList, decodeFaces, encodeFaceCommands, shapeMaterials, type BrushVertex } from "./mapBrushGeometry";
import { mapBrushContext } from "./mapGrass";
import { GRASS_Z_OFFSET, packGrassCommands, terrainModelLayout, writeTerrainModel } from "./mapGrassGeometry";
import { brushDestinations, permission, treeGround, writePermission } from "./mapTrees";
import { ensure, materialRecords } from "./nitroResourceWriter";
import { markDirty, type ProjectState } from "./projectStore";

/**
 * Erasing the map's own grass and trees. Native art is part of the terrain's display lists, often one long face
 * across many tiles (a grass rectangle, a row of tree cards), so erasing cuts the faces: what lies inside the erased
 * area goes, the rest is kept with its texture coordinates interpolated. The ground under the art is already there.
 * The game keeps no record of what a tree or grass tile replaced, so those tiles take the most common plain ground
 * value around them.
 */
const TILE = 16;
const TREE_MATERIAL = /^ki\d/;
const GRASS_MATERIALS = new Set(["kusa_ec1", "kusa_ec2", "kusa_ec3", "kusa_ec1s", "kusa_ec2s"]);
const GRASS_CLASSES = new Set([4, 5, 6]);
const EPS = 1e-4;

type Rect = { x0: number; x1: number; z0: number; z1: number };
type Face = BrushVertex[];

const bounds = (face: readonly BrushVertex[]): Rect => ({
  x0: Math.min(...face.map(v => v.position[0])), x1: Math.max(...face.map(v => v.position[0])),
  z0: Math.min(...face.map(v => v.position[2])), z1: Math.max(...face.map(v => v.position[2])),
});
const tileRect = (index: number): Rect => {
  const x = (index % 32 - 16) * TILE, z = (Math.floor(index / 32) - 16) * TILE;
  return { x0: x, x1: x + TILE, z0: z, z1: z + TILE };
};

// ---------- Cutting faces ----------

const s16 = (value: number) => (value << 16) >> 16;
const s10 = (value: number) => (value << 22) >> 22;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function mixColor(a: number, b: number, t: number) {
  const channel = (value: number, shift: number) => (value >>> shift) & 31;
  return [0, 5, 10].reduce((out, shift) => out | (Math.round(lerp(channel(a, shift), channel(b, shift), t)) << shift), 0);
}

function mixNormal(a: number, b: number, t: number) {
  const unpack = (value: number) => [s10(value), s10(value >>> 10), s10(value >>> 20)].map(n => n / 512);
  const [na, nb] = [unpack(a), unpack(b)], n = na.map((value, i) => lerp(value, nb[i], t));
  const length = Math.hypot(...n) || 1;
  return n.map(value => Math.max(-512, Math.min(511, Math.round(value / length * 512))) & 1023).reduce((out, value, i) => out | (value << (i * 10)), 0) >>> 0;
}

/** The point a fraction t of the way from a to b, with every attribute the face carries. */
function between(a: BrushVertex, b: BrushVertex, t: number): BrushVertex {
  const vertex: BrushVertex = { ...a, position: [0, 1, 2].map(i => lerp(a.position[i], b.position[i], t)) as [number, number, number] };
  if (a.texcoord !== undefined && b.texcoord !== undefined) {
    const u = Math.round(lerp(s16(a.texcoord), s16(b.texcoord), t)), v = Math.round(lerp(s16(a.texcoord >>> 16), s16(b.texcoord >>> 16), t));
    vertex.texcoord = ((u & 0xffff) | ((v & 0xffff) << 16)) >>> 0;
  }
  if (a.color !== undefined && b.color !== undefined && a.color !== b.color) vertex.color = mixColor(a.color, b.color, t);
  if (a.normal !== undefined && b.normal !== undefined && a.normal !== b.normal) vertex.normal = mixNormal(a.normal, b.normal, t);
  return vertex;
}

/** Keep the part of a polygon on one side of an axis line (x or z) — Sutherland–Hodgman in the ground plane. */
function clip(polygon: Face, axis: 0 | 2, limit: number, keepBelow: boolean): Face {
  const inside = (v: BrushVertex) => keepBelow ? v.position[axis] <= limit + EPS : v.position[axis] >= limit - EPS;
  const out: Face = [];
  polygon.forEach((current, i) => {
    const previous = polygon[(i + polygon.length - 1) % polygon.length];
    const [a, b] = [inside(previous), inside(current)];
    if (a !== b) {
      const span = current.position[axis] - previous.position[axis];
      out.push(between(previous, current, Math.abs(span) < EPS ? 0 : (limit - previous.position[axis]) / span));
    }
    if (b) out.push(current);
  });
  return out;
}

function area(face: Face) {
  let total = 0;
  for (let i = 1; i + 1 < face.length; i++) {
    const [a, b, c] = [face[0], face[i], face[i + 1]].map(v => v.position);
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    total += Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]) / 2;
  }
  return total;
}

/** Drop repeated corners left by clipping, then split anything past a quad into a fan of triangles. */
function tidy(face: Face): Face[] {
  const points = face.filter((v, i) => {
    const next = face[(i + 1) % face.length];
    return next === v || Math.hypot(...v.position.map((n, axis) => n - next.position[axis])) > 1e-3;
  });
  if (points.length < 3 || area(points) < 1e-2) return [];
  if (points.length <= 4) return [points];
  return points.slice(1, -1).map((_, i) => [points[0], points[i + 1], points[i + 2]]);
}

/** A face with a rectangle (in the ground plane) cut out of it. */
export function cutRect(face: Face, rect: Rect): Face[] {
  const box = bounds(face);
  if (box.x1 <= rect.x0 + EPS || box.x0 >= rect.x1 - EPS || box.z1 <= rect.z0 + EPS || box.z0 >= rect.z1 - EPS) return [face];
  const middle = clip(clip(face, 0, rect.x0, false), 0, rect.x1, true);
  return [
    clip(face, 0, rect.x0, true),
    clip(face, 0, rect.x1, false),
    clip(middle, 2, rect.z0, true),
    clip(middle, 2, rect.z1, false),
  ].flatMap(tidy);
}

// ---------- Finding native trees ----------

/**
 * A tree's footprint from the flat faces (shadow and canopy slices) over a tile. A forest draws these as long strips
 * covering a row of trees, one tree every `size` units from the strip's corner, so the tile's tree is the lattice cell
 * of the strip that holds it. Large trees (the "…1" materials) are 3×3 tiles; the rest are 2×2.
 */
export function nativeTreeAt(faces: readonly { face: BrushVertex[]; size: number }[], tile: Rect): Rect | undefined {
  const cx = (tile.x0 + tile.x1) / 2, cz = (tile.z0 + tile.z1) / 2;
  for (const { face, size } of faces) {
    const ys = face.map(v => v.position[1]);
    if (Math.max(...ys) - Math.min(...ys) > 0.1) continue;
    const b = bounds(face);
    if (cx <= b.x0 || cx >= b.x1 || cz <= b.z0 || cz >= b.z1) continue;
    const x0 = b.x0 + Math.floor((cx - b.x0) / size) * size, z0 = b.z0 + Math.floor((cz - b.z0) / size) * size;
    const snap = (value: number) => Math.round(value / TILE) * TILE;
    return { x0: snap(x0), x1: snap(x0) + size, z0: snap(z0), z1: snap(z0) + size };
  }
  return undefined;
}

// ---------- One terrain model ----------

/** Cut native trees covering any of the tiles, and native grass on the tiles, out of a terrain model. */
export function eraseNativeArt(modelFile: Uint8Array, tiles: ReadonlySet<number>): { file: Uint8Array; treeTiles: Set<number>; trees: number; grassTiles: Set<number> } {
  const layout = terrainModelLayout(modelFile, "eraser"), records = materialRecords(modelFile);
  const draws = shapeMaterials(modelFile).draws;
  const shapeFaces = new Map<number, { kind: "tree" | "grass"; size: number; faces: BrushVertex[][] }>();
  for (const { shape, material } of draws) {
    const name = records[material]?.name ?? "";
    const kind = TREE_MATERIAL.test(name) ? "tree" : GRASS_MATERIALS.has(name) ? "grass" : undefined;
    if (!kind || shapeFaces.has(shape)) continue;
    shapeFaces.set(shape, { kind, size: /^ki\d\d[a-d]x?1$/.test(name) ? 3 * TILE : 2 * TILE, faces: decodeFaces(layout.shapes[shape].list, layout.scale) });
  }
  // Trees: every tree whose footprint holds an erased tile, whole.
  const flat = [...shapeFaces.values()].filter(entry => entry.kind === "tree").flatMap(entry => entry.faces.map(face => ({ face, size: entry.size })));
  const trees: { footprint: Rect }[] = [];
  for (const index of tiles) {
    const footprint = nativeTreeAt(flat, tileRect(index));
    if (footprint && !trees.some(tree => tree.footprint.x0 === footprint.x0 && tree.footprint.z0 === footprint.z0)) trees.push({ footprint });
  }
  /** A face that lies within a tree's footprint (with a little overhang) belongs to that tree alone. */
  const ownedBy = (face: BrushVertex[]) => {
    const b = bounds(face);
    return trees.some(({ footprint: f }) => b.x0 >= f.x0 - 2 && b.x1 <= f.x1 + 2 && b.z0 >= f.z0 - 2 && b.z1 <= f.z1 + 2);
  };
  const treeTiles = new Set<number>();
  for (const { footprint } of trees) {
    for (let z = footprint.z0; z < footprint.z1; z += TILE) for (let x = footprint.x0; x < footprint.x1; x += TILE) treeTiles.add((z / TILE + 16) * 32 + x / TILE + 16);
  }
  // Grass: the erased tiles' squares, which native grass draws two units further along z.
  const grassRects = [...tiles].map(index => { const r = tileRect(index); return { index, rect: { ...r, z0: r.z0 + GRASS_Z_OFFSET, z1: r.z1 + GRASS_Z_OFFSET } }; });
  const grassTiles = new Set<number>();
  const lists = new Map<string, Uint8Array>();
  let delta = { vertices: 0, polygons: 0, quads: 0 };
  for (const [shape, { kind, faces }] of shapeFaces) {
    let changed = false;
    const kept = faces.flatMap(face => {
      if (kind === "tree") {
        if (ownedBy(face)) { changed = true; return []; }
        let pieces: Face[] = [face];
        for (const { footprint } of trees) pieces = pieces.flatMap(piece => cutRect(piece, footprint));
        if (pieces.length !== 1 || pieces[0] !== face) changed = true;
        return pieces;
      }
      let pieces: Face[] = [face];
      for (const { index, rect } of grassRects) {
        const next = pieces.flatMap(piece => cutRect(piece, rect));
        if (next.length !== pieces.length || next.some((piece, i) => piece !== pieces[i])) { changed = true; grassTiles.add(index); }
        pieces = next;
      }
      return pieces;
    });
    if (!changed) continue;
    const source = layout.shapes[shape];
    const list = kept.length ? packGrassCommands(encodeFaceCommands(kept, layout.scale, "eraser")) : new Uint8Array(4);
    const before = countDisplayList(source.list), after = countDisplayList(list);
    delta = { vertices: delta.vertices + after.vertices - before.vertices, polygons: delta.polygons + after.polygons - before.polygons, quads: delta.quads + after.quads - before.quads };
    lists.set(source.name, list);
  }
  if (!lists.size) return { file: modelFile, treeTiles, trees: trees.length, grassTiles };
  ensure(readU16(layout.original, 38) + delta.polygons <= 2048 && readU16(layout.original, 36) + delta.vertices <= 6144,
    "Cutting this art would pass the DS geometry limit for the chunk. Erase a whole patch at once, or a smaller area.");
  const next = { ...layout, shapes: layout.shapes.map(shape => ({ ...shape, list: lists.get(shape.name) ?? shape.list })) };
  return { file: writeTerrainModel(modelFile, next, layout.sbc, delta), treeTiles, trees: trees.length, grassTiles };
}

// ---------- Tiles ----------

const isTreeTile = (tile: Gen5PermissionTileLike) => tile.tileClass === 1 || Boolean(tile.flags & 1);
const isGrassTile = (tile: Gen5PermissionTileLike) => GRASS_CLASSES.has(tile.tileClass);

/** The most common plain ground value near the erased tiles, searching outward a ring at a time. */
export function surroundingGround(per: Uint8Array, erased: ReadonlySet<number>): Gen5PermissionTileLike {
  const xs = [...erased].map(i => i % 32), zs = [...erased].map(i => Math.floor(i / 32));
  for (let ring = 1; ring <= 4; ring++) {
    const votes = new Map<string, { tile: Gen5PermissionTileLike; count: number }>();
    for (let z = Math.min(...zs) - ring; z <= Math.max(...zs) + ring; z++) for (let x = Math.min(...xs) - ring; x <= Math.max(...xs) + ring; x++) {
      if (x < 0 || z < 0 || x > 31 || z > 31 || erased.has(z * 32 + x)) continue;
      const tile = permission(per, z * 32 + x);
      if (treeGround(tile) !== true) continue;
      const key = `${tile.tileClass}/${tile.flags}`, vote = votes.get(key) ?? { tile, count: 0 };
      vote.count++;
      votes.set(key, vote);
    }
    const best = [...votes.values()].sort((a, b) => b.count - a.count)[0];
    if (best) return best.tile;
  }
  return { tileClass: 0, flags: 0 };
}

function restoreTiles(per: Uint8Array, treeTiles: ReadonlySet<number>, grassTiles: ReadonlySet<number>) {
  const erased = new Set([...treeTiles, ...grassTiles]);
  const changed = [...erased].filter(index => {
    const tile = permission(per, index);
    return (treeTiles.has(index) && isTreeTile(tile)) || (grassTiles.has(index) && isGrassTile(tile));
  });
  if (!changed.length) return 0;
  const ground = surroundingGround(per, erased);
  for (const index of changed) writePermission(per, index, ground);
  return changed.length;
}

// ---------- Strokes ----------

type MapChange = { id: number; before: Uint8Array; after: Uint8Array };
export type NativeEraseStroke = { maps: MapChange[]; trees: number; grassTiles: number };

/** Erase the map's own trees and grass under the tiles, in every seasonal variant of each chunk. */
export async function eraseNativeMapArt(project: ProjectState, scene: Map3dSceneData, tiles: readonly Map3dTile[], { isCurrent = () => true }: { isCurrent?: () => boolean } = {}): Promise<NativeEraseStroke> {
  const result: NativeEraseStroke = { maps: [], trees: 0, grassTiles: 0 };
  if (!tiles.length) return result;
  const context = await mapBrushContext(project, scene, isCurrent, "eraser");
  ensure(isCurrent(), "The map changed while erasing. Try again.");
  const perMap = new Map<number, { tiles: Set<number>; active: boolean }>();
  for (const { tileIndex, variants } of brushDestinations(scene, tiles, context, () => {})) {
    variants.forEach(({ id }, i) => {
      const entry = perMap.get(id) ?? { tiles: new Set<number>(), active: false };
      entry.tiles.add(tileIndex);
      if (i === 0) entry.active = true;
      perMap.set(id, entry);
    });
  }
  for (const [id, { tiles: indices, active }] of perMap) {
    const bytes = context.maps.rawFiles[id];
    if (!bytes?.length) continue;
    const map = readGen5MapBin(bytes);
    const art = eraseNativeArt(map.files[0], indices);
    if (art.file === map.files[0]) continue;
    const files = map.files.slice();
    files[0] = art.file;
    files[1] = files[1].slice();
    restoreTiles(files[1], art.treeTiles, art.grassTiles);
    if (map.placements === 3) { files[2] = files[2].slice(); restoreTiles(files[2], art.treeTiles, art.grassTiles); }
    const after = packGameFreakContainer(map.signature, files);
    if (equalMapBytes(after, bytes)) continue;
    result.maps.push({ id, before: bytes.slice(), after });
    if (active) { result.trees += art.trees; result.grassTiles += art.grassTiles.size; }
  }
  if (result.maps.length) writeNativeErase(project, result, false);
  return result;
}

function writeNativeErase(project: ProjectState, stroke: NativeEraseStroke, undo: boolean) {
  const store = project.narcs.maps!;
  for (const { id, before, after } of stroke.maps) {
    store.rawFiles[id] = (undo ? before : after).slice();
    store.records.delete(id);
    markDirty(project, "maps", id);
  }
  const parts = [stroke.trees && `${stroke.trees} tree${stroke.trees === 1 ? "" : "s"}`, stroke.grassTiles && `${stroke.grassTiles} grass tile${stroke.grassTiles === 1 ? "" : "s"}`].filter(Boolean).join(" and ") || "native art";
  recordGenericChange(project, "maps3d", undo ? `Restored the map's own ${parts}.` : `Erased the map's own ${parts}.`, "Erase Native Art");
}

export function undoNativeErase(project: ProjectState, stroke: NativeEraseStroke) {
  ensure(stroke.maps.every(({ id, after }) => project.narcs.maps?.rawFiles[id] && equalMapBytes(project.narcs.maps.rawFiles[id], after)), "Map resources changed after this erase.");
  writeNativeErase(project, stroke, true);
}

export function redoNativeErase(project: ProjectState, stroke: NativeEraseStroke) {
  ensure(stroke.maps.every(({ id, before }) => project.narcs.maps?.rawFiles[id] && equalMapBytes(project.narcs.maps.rawFiles[id], before)), "Map resources changed after this erase was undone.");
  writeNativeErase(project, stroke, false);
}
