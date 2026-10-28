import { studioAssert, type StudioChunk, type StudioWorkspace } from "./mapStudioFormats";

export type StudioTool = "paint" | "erase" | "fill" | "pick" | "height" | "pan";
type CellChange = { chunk: number; layer: number; index: number; tile: number; height: number; nextTile: number; nextHeight: number };
/** A drag is one command. Store changed cells, never snapshots of the entire map. */
export class StudioHistory {
  private past: CellChange[][] = [];
  private future: CellChange[][] = [];
  private stroke = new Map<string, CellChange>();
  revision = 0;
  constructor(readonly workspace: StudioWorkspace) {}
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
  get painting() { return this.stroke.size > 0; }
  set(chunkIndex: number, layer: number, index: number, tile: number, height: number) {
    const chunk = this.workspace.map.chunks[chunkIndex];
    studioAssert(chunk && layer >= 0 && layer < 9 && index >= 0 && index < 1024, "Invalid paint destination.");
    studioAssert(Number.isInteger(height) && height >= -128 && height <= 127, "Use a whole-number height from −128 to 127.");
    studioAssert(Number.isInteger(tile) && tile >= -1 && tile < this.workspace.tileset.tiles.length, "Choose an available tile.");
    if (chunk.tiles[layer][index] === tile && chunk.heights[layer][index] === height) return;
    const key = `${chunkIndex}:${layer}:${index}`;
    const change = this.stroke.get(key) ?? { chunk: chunkIndex, layer, index, tile: chunk.tiles[layer][index], height: chunk.heights[layer][index], nextTile: tile, nextHeight: height };
    change.nextTile = tile; change.nextHeight = height; this.stroke.set(key, change);
    chunk.tiles[layer][index] = tile; chunk.heights[layer][index] = height;
  }
  paint(chunkIndex: number, layer: number, x: number, y: number, tile: number, height: number, tool: StudioTool) {
    if (x < 0 || y < 0 || x >= 32 || y >= 32) return;
    const chunk = this.workspace.map.chunks[chunkIndex], index = y * 32 + x;
    if (tool === "height") { if (chunk.tiles[layer][index] >= 0) this.set(chunkIndex, layer, index, chunk.tiles[layer][index], height); return; }
    if (tool === "erase") { this.set(chunkIndex, layer, index, -1, 0); return; }
    if (tool === "fill") {
      const previous = chunk.tiles[layer][index], oldHeight = chunk.heights[layer][index];
      const visited = new Uint8Array(1024), queue = [index];
      while (queue.length) {
        const i = queue.pop()!; if (visited[i]) continue; visited[i] = 1;
        if (chunk.tiles[layer][i] !== previous || chunk.heights[layer][i] !== oldHeight) continue;
        this.set(chunkIndex, layer, i, tile, height);
        if (i % 32) queue.push(i - 1); if (i % 32 < 31) queue.push(i + 1); if (i >= 32) queue.push(i - 32); if (i < 992) queue.push(i + 32);
      }
      return;
    }
    if (tool !== "paint") return;
    const stamp = this.workspace.tileset.tiles[tile]; if (!stamp) return;
    studioAssert(x + stamp.width <= 32 && y + stamp.height <= 32, "The tile extends past this map chunk.");
    for (let dy = 0; dy < stamp.height; dy++) for (let dx = 0; dx < stamp.width; dx++) this.set(chunkIndex, layer, (y + dy) * 32 + x + dx, dx === 0 && dy === 0 ? tile : -1, height);
  }
  finish() {
    const changes = [...this.stroke.values()].filter(c => c.tile !== c.nextTile || c.height !== c.nextHeight); this.stroke.clear();
    if (!changes.length) return false;
    this.past.push(changes); if (this.past.length > 100) this.past.shift(); this.future = []; this.revision++; return true;
  }
  private restore(changes: CellChange[], forward: boolean) {
    for (const c of changes) { const chunk = this.workspace.map.chunks[c.chunk]; chunk.tiles[c.layer][c.index] = forward ? c.nextTile : c.tile; chunk.heights[c.layer][c.index] = forward ? c.nextHeight : c.height; }
    this.revision++;
  }
  undo() { this.finish(); const changes = this.past.pop(); if (!changes) return false; this.restore(changes, false); this.future.push(changes); return true; }
  redo() { const changes = this.future.pop(); if (!changes) return false; this.restore(changes, true); this.past.push(changes); return true; }
}

export type StudioMesh = { material: number; positions: number[]; uvs: number[]; colors: number[]; indices: number[] };
/** PDSMS coordinates are X/right, Y/down the grid, Z/up. Preview uses Y/up. */
export function studioMeshes(workspace: StudioWorkspace, chunk: StudioChunk, visible = Array(9).fill(true) as boolean[], selectedTile?: number): StudioMesh[] {
  const meshes = new Map<number, StudioMesh>();
  const addTile = (id: number, x: number, y: number, height: number) => {
    const tile = workspace.tileset.tiles[id]; if (!tile) return;
    for (const [faces, offsets] of [[tile.quads, tile.quadOffsets], [tile.triangles, tile.triOffsets]] as const) {
      for (const [i, face] of faces.entries()) {
        let group = 0; for (let m = 0; m < offsets.length; m++) if (i >= offsets[m]) group = m;
        const material = tile.materials[group] ?? tile.materials[0] ?? 0;
        let mesh = meshes.get(material); if (!mesh) { mesh = { material, positions: [], uvs: [], colors: [], indices: [] }; meshes.set(material, mesh); }
        const base = mesh.positions.length / 3;
        for (let v = 0; v < face.v.length; v++) {
          const vi = (face.v[v] - 1) * 3, ti = (face.t[v] - 1) * 2, ci = (face.c[v] - 1) * 3;
          const px = tile.vertices[vi] + x - 16 + tile.x, py = tile.vertices[vi + 1] + y - 16 + tile.y, pz = tile.vertices[vi + 2] + height + tile.z;
          mesh.positions.push(px, pz, py);
          mesh.uvs.push(tile.globalMapping ? px * tile.globalScale : tile.uvs[ti] ?? 0, tile.globalMapping ? py * tile.globalScale : tile.uvs[ti + 1] ?? 0);
          const colored = workspace.tileset.materials[material]?.vertexColors;
          mesh.colors.push(...(colored ? [tile.colors[ci] ?? 1, tile.colors[ci + 1] ?? 1, tile.colors[ci + 2] ?? 1] : [1, 1, 1]));
        }
        // Swapping the source Y/Z axes reverses handedness.
        for (let v = 1; v < face.v.length - 1; v++) mesh.indices.push(base, base + v + 1, base + v);
      }
    }
  };
  if (selectedTile !== undefined) addTile(selectedTile, 16, 16, 0);
  else for (let layer = 0; layer < 9; layer++) if (visible[layer]) for (let i = 0; i < 1024; i++) if (chunk.tiles[layer][i] >= 0) addTile(chunk.tiles[layer][i], i % 32, Math.floor(i / 32), chunk.heights[layer][i]);
  return [...meshes.values()];
}

/** Triangle sampling is also used for native walking heights, not just the preview. */
export function studioSurface(meshes: StudioMesh[], x: number, y: number): number | undefined {
  let top: number | undefined;
  for (const mesh of meshes) for (let i = 0; i < mesh.indices.length; i += 3) {
    const [a, b, c] = mesh.indices.slice(i, i + 3).map(index => mesh.positions.slice(index * 3, index * 3 + 3));
    const det = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
    if (Math.abs(det) < 1e-8) continue;
    const u = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (y - c[2])) / det;
    const v = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (y - c[2])) / det, w = 1 - u - v;
    if (Math.min(u, v, w) < -1e-5) continue;
    const height = u * a[1] + v * b[1] + w * c[1]; if (top === undefined || height > top) top = height;
  }
  return top;
}
