import { studioAssert, type StudioTile, type StudioTileLayout, type StudioWorkspace } from "./mapStudioFormats";
import { studioCellKey, type StudioHistory } from "./mapStudioModel";

export type StudioSmartBrush = { id: string; name: string; key: string; cells: number[]; extras: number[]; tiles: Set<number>; bakeMapping: boolean };
const offsets = [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]];
const canonical = [208,248,104,214,255,107,22,31,11,127,223,251,254];
const brushes = new WeakMap<StudioWorkspace, Map<string, StudioSmartBrush>>();
const coordinates = new WeakMap<StudioWorkspace, { length: number; map: Map<string, number> }>();

export function studioSmartBrushIssue(ws: StudioWorkspace, layout: StudioTileLayout): string | undefined {
  if (layout.columns !== 3 || layout.rows !== 3 || layout.cells.length !== 9) return "Smart brushes need a 3×3 layout.";
  if (layout.cells.some((id,i) => i !== 4 && (id < 0 || !ws.tileset.tiles[id])) || !(layout.cells[4] === -1 || Number.isInteger(layout.cells[4]) && !!ws.tileset.tiles[layout.cells[4]])) return "Fill all eight boundary cells before using this layout as a brush.";
  const ids = [...layout.cells, ...layout.extras || []].filter(id => id >= 0);
  for (const id of ids) {
    const t = ws.tileset.tiles[id];
    if (!t || t.width !== 1 || t.height !== 1) return "Smart brush pieces must be 1×1 tiles.";
    if (!t.globalMapping) for (const face of [...t.quads, ...t.triangles]) if (face.t.some(i => i > 0 && (!Number.isFinite(t.uvs[(i-1)*2]) || !Number.isFinite(t.uvs[(i-1)*2+1])))) return "Repair this layout's invalid UV coordinates before using it as a brush.";
  }
}
export function prepareStudioSmartBrush(ws: StudioWorkspace, layout: StudioTileLayout): StudioSmartBrush {
  const extras = Array.from({ length: 4 }, (_, i) => layout.extras?.[i] ?? -1), key = `${layout.id}|${[...layout.cells, ...extras].join(",")}`;
  let cache = brushes.get(ws); if (!cache) brushes.set(ws, cache = new Map());
  let brush = cache.get(key);
  if (!brush) {
    const issue = studioSmartBrushIssue(ws, layout); studioAssert(!issue, issue || "Invalid smart brush.");
    const tiles = new Set([...layout.cells, ...extras].filter(id => id >= 0)), first = ws.tileset.tiles[[...tiles][0]];
    const bakeMapping = [...tiles].some(id => { const tile = ws.tileset.tiles[id]; return tile.globalMapping !== first.globalMapping || tile.globalMapping && tile.globalScale !== first.globalScale; });
    brush = { id: layout.id, name: layout.name, key, cells: [...layout.cells], extras, tiles, bakeMapping }; cache.set(key, brush);
  }
  brush.name = layout.name;
  return brush;
}

/** Select one source piece per quarter; diagonal holes use the displayed inner-corner block. */
export function studioSmartQuarters(brush: StudioSmartBrush, mask: number): number[] {
  const n = !!(mask & 2), e = !!(mask & 16), s = !!(mask & 64), w = !!(mask & 8);
  const vertical = [n,n,s,s], horizontal = [w,e,w,e], diagonal = [1,4,32,128], outer = [0,2,6,8], edgeV = [1,1,7,7], edgeH = [3,5,3,5];
  return diagonal.map((bit, q) => {
    if (!vertical[q] && !horizontal[q]) return brush.cells[outer[q]];
    if (!vertical[q]) return brush.cells[edgeV[q]];
    if (!horizontal[q]) return brush.cells[edgeH[q]];
    if (mask & bit) return brush.cells[4];
    const tile = brush.extras[3-q];
    studioAssert(tile >= 0, `“${brush.name}” needs its ${["bottom-right", "bottom-left", "top-right", "top-left"][q]} inner-corner slot. Add it in Arrange tiles.`);
    return tile;
  });
}

type Vertex = { p: number[]; uv: number[]; n: number[]; c: number[] };
type Origin = { x: number; y: number };
function mappingPhase(value: number, scale: number, wrap: number) { const raw = (value-16)*scale, period = wrap === 2 ? 2 : 1; return wrap === 1 ? raw : (raw%period+period)%period; }
function mappingKey(ws: StudioWorkspace, quarters: number[], origin: Origin) {
  return quarters.filter(id => id >= 0 && ws.tileset.tiles[id].globalMapping).flatMap(id => { const tile = ws.tileset.tiles[id]; return (tile.materials.length ? tile.materials : [0]).map(m => { const material = ws.tileset.materials[m]; return `${mappingPhase(origin.x,tile.globalScale,material.repeatU)},${mappingPhase(origin.y,tile.globalScale,material.repeatV)}`; }); }).join(";");
}
function clip(vertices: Vertex[], axis: number, limit: number, keepAbove: boolean): Vertex[] {
  const result: Vertex[] = [], inside = (v: Vertex) => keepAbove ? v.p[axis] >= limit - 1e-7 : v.p[axis] <= limit + 1e-7;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i], b = vertices[(i+1)%vertices.length], aIn = inside(a), bIn = inside(b);
    if (aIn) result.push(a);
    if (aIn !== bIn) {
      const t = (limit - a.p[axis]) / (b.p[axis] - a.p[axis]), mix = (x: number[], y: number[]) => x.map((n, i) => n + (y[i]-n)*t);
      result.push({ p: mix(a.p,b.p), uv: mix(a.uv,b.uv), n: mix(a.n,b.n), c: mix(a.c,b.c) });
    }
  }
  const cleaned = result.filter((v, i) => !i || Math.hypot(...v.p.map((n,a) => n-result[i-1].p[a])) > 1e-9);
  if (cleaned.length > 1 && Math.hypot(...cleaned[0].p.map((n,a) => n-cleaned.at(-1)!.p[a])) < 1e-9) cleaned.pop();
  return cleaned;
}
/** Clip actual terrain geometry, not flattened sprites, so cliffs retain their height and materials. */
export function composeStudioSmartTile(ws: StudioWorkspace, brush: StudioSmartBrush, quarters: number[], origin: Origin = { x: 16, y: 16 }): StudioTile {
  const source = ws.tileset.tiles[brush.cells[4] >= 0 ? brush.cells[4] : brush.cells[0]], output: StudioTile = { ...source, globalMapping: brush.bakeMapping ? false : source.globalMapping, name: `Smart · ${brush.name}`, folder: undefined, width: 1, height: 1, x: 0, y: 0, z: 0, vertices: [], uvs: [], normals: [], colors: [], triangles: [], quads: [], materials: [], triOffsets: [], quadOffsets: [] };
  const polygons = new Map<number, Vertex[][]>(), seen = new Set<string>();
  for (const [quarter, id] of quarters.entries()) {
    if (id < 0) continue;
    const tile = ws.tileset.tiles[id];
    for (const [faces, starts] of [[tile.quads,tile.quadOffsets],[tile.triangles,tile.triOffsets]] as const) for (const [index, face] of faces.entries()) {
      let group = 0; for (let i = 0; i < starts.length; i++) if (index >= starts[i]) group = i;
      const material = tile.materials[group] ?? tile.materials[0] ?? 0;
      const vertices = face.v.map((v, i): Vertex => {
        const vi = (v-1)*3, ti = (face.t[i]-1)*2, ni = (face.n[i]-1)*3, ci = (face.c[i]-1)*3;
        const p = [tile.vertices[vi]+tile.x,tile.vertices[vi+1]+tile.y,tile.vertices[vi+2]+tile.z], m = ws.tileset.materials[material];
        const uv = brush.bakeMapping && tile.globalMapping ? [p[0]*tile.globalScale+mappingPhase(origin.x,tile.globalScale,m.repeatU),p[1]*tile.globalScale+mappingPhase(origin.y,tile.globalScale,m.repeatV)] : [tile.uvs[ti] ?? 0,tile.uvs[ti+1] ?? 0];
        return { p, uv, n: [0,1,2].map(a => Number.isFinite(tile.normals[ni+a]) ? tile.normals[ni+a] : a === 2 ? 1 : 0), c: [0,1,2].map(a => tile.colors[ci+a] ?? 1) };
      });
      // Match the renderer's triangle split before interpolating across a clipped face.
      for (let i = 1; i < vertices.length-1; i++) {
        let polygon = clip([vertices[0],vertices[i],vertices[i+1]], 0, 0.5, quarter % 2 === 1);
        polygon = clip(polygon, 1, 0.5, quarter >= 2);
        if (polygon.length < 3) continue;
        const a = polygon[0].p, cross = [0,0,0];
        for (let f = 1; f < polygon.length-1; f++) { const b = polygon[f].p, c = polygon[f+1].p; cross[0] += (b[1]-a[1])*(c[2]-a[2])-(b[2]-a[2])*(c[1]-a[1]); cross[1] += (b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]); cross[2] += (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]); }
        if (Math.hypot(...cross) < 1e-10) continue;
        const signature = `${material}|${polygon.map(v => [...v.p,...v.uv,...v.c].map(n => n.toFixed(6)).join(",")).sort().join(";")}`;
        if (seen.has(signature)) continue; seen.add(signature);
        let list = polygons.get(material); if (!list) polygons.set(material,list = []); list.push(polygon);
      }
    }
  }
  for (const [material, faces] of polygons) {
    output.materials.push(material); output.triOffsets.push(output.triangles.length); output.quadOffsets.push(output.quads.length);
    for (const face of faces) {
      const ids = face.map(v => { const id = output.vertices.length/3+1; output.vertices.push(...v.p); output.uvs.push(...v.uv); output.normals.push(...v.n); output.colors.push(...v.c); return id; });
      const append = (v: number[], quad: boolean) => (quad ? output.quads : output.triangles).push({ v, t: [...v], n: [...v], c: [...v] });
      if (ids.length === 4) append(ids,true); else for (let i = 1; i < ids.length-1; i++) append([ids[0],ids[i],ids[i+1]],false);
    }
  }
  studioAssert(output.triangles.length + output.quads.length > 0, "This smart brush has no geometry in the required quarters.");
  return output;
}

type Cell = { chunk: number; index: number };
function near(ws: StudioWorkspace, chunkIndex: number, x: number, y: number): Cell | undefined {
  let cache = coordinates.get(ws); if (!cache || cache.length !== ws.map.chunks.length) { cache = { length: ws.map.chunks.length, map: new Map(ws.map.chunks.map((c,i) => [`${c.x},${c.y}`,i])) }; coordinates.set(ws,cache); }
  const c = ws.map.chunks[chunkIndex], target = cache.map.get(`${c.x+Math.floor(x/32)},${c.y+Math.floor(y/32)}`);
  return target === undefined ? undefined : { chunk: target, index: ((y%32+32)%32)*32+(x%32+32)%32 };
}

/** Plans the whole local repair before applying it, including the adjacent chunk at a seam. */
export function paintStudioSmart(history: StudioHistory, layout: StudioTileLayout, chunkIndex: number, layer: number, x: number, y: number, height: number, erase = false) {
  const ws = history.workspace, brush = prepareStudioSmartBrush(ws,layout), chunk = ws.map.chunks[chunkIndex];
  studioAssert(chunk && Number.isInteger(x) && Number.isInteger(y) && Number.isInteger(layer) && layer >= 0 && layer < 9 && Number.isInteger(height) && height >= -128 && height <= 127, "Choose a valid layer, cell and whole-number height from −128 to 127.");
  if (x < 0 || x >= 32 || y < 0 || y >= 32) return;
  const target = { chunk: chunkIndex, index: y*32+x }, targetKey = studioCellKey(chunkIndex,layer,target.index), oldTile = chunk.tiles[layer][target.index], oldHeight = chunk.heights[layer][target.index], oldOwner = ws.smart?.cells[targetKey];
  const belongs = (cell: Cell | undefined, selected: StudioSmartBrush, level: number, projected: boolean) => {
    if (!cell) return false; const key = studioCellKey(cell.chunk,layer,cell.index);
    if (projected && key === targetKey) return !erase && selected.id === brush.id && height === level;
    const c = ws.map.chunks[cell.chunk], id = c.tiles[layer][cell.index]; if (c.heights[layer][cell.index] !== level) return false;
    const owner = ws.smart?.cells[key]; return owner ? owner === selected.id : id >= 0 && selected.tiles.has(id);
  };
  if (erase && !belongs(target,brush,oldHeight,false)) return;
  const repairs: { brush: StudioSmartBrush; height: number }[] = [{ brush, height }];
  if (oldHeight !== height && belongs(target,brush,oldHeight,false)) repairs.push({ brush, height: oldHeight });
  if (oldOwner && oldOwner !== brush.id) { const previous = ws.layouts?.find(l => l.id === oldOwner); if (previous && !studioSmartBrushIssue(ws,previous)) repairs.push({ brush: prepareStudioSmartBrush(ws,previous), height: oldHeight }); }
  if (erase && oldHeight !== height) repairs.push({ brush, height: oldHeight });
  const variants = new Map<string, { quarters: number[]; brush: StudioSmartBrush; origin: Origin; tile?: StudioTile; id?: number }>();
  const planned = new Map<string, { cell: Cell; brush: StudioSmartBrush; height: number; tile?: number; variant?: string }>();
  for (const repair of repairs) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const cell = near(ws,chunkIndex,x+dx,y+dy); if (!belongs(cell,repair.brush,repair.height,true)) continue;
    let mask = 0; for (const [i,[nx,ny]] of offsets.entries()) if (belongs(near(ws,cell!.chunk,cell!.index%32+nx,Math.floor(cell!.index/32)+ny),repair.brush,repair.height,true)) mask |= 1<<i;
    const quarters = studioSmartQuarters(repair.brush,mask), signature = quarters.join(",");
    let tile: number | undefined;
    for (let i = 0; i < canonical.length; i++) {
      const candidate = i < 9 ? repair.brush.cells[i] : repair.brush.extras[i-9]; if (candidate < 0 && i !== 4) continue;
      try { if (studioSmartQuarters(repair.brush,canonical[i]).join(",") === signature) { tile = candidate; break; } } catch { /* A missing optional inner piece cannot match this preset. */ }
    }
    const origin = { x: cell!.index%32, y: Math.floor(cell!.index/32) };
    const variant = tile === undefined ? `${repair.brush.key}|${signature}${repair.brush.bakeMapping ? "|"+mappingKey(ws,quarters,origin) : ""}` : undefined;
    if (variant && !variants.has(variant)) variants.set(variant,{ quarters, brush: repair.brush, origin });
    planned.set(studioCellKey(cell!.chunk,layer,cell!.index),{ cell: cell!, brush: repair.brush, height: repair.height, tile, variant });
  }
  // Build new variants before changing any cells, so an invalid template leaves this point untouched.
  for (const [key, v] of variants) { v.id = ws.smart?.variants[key]; if (v.id === undefined) v.tile = composeStudioSmartTile(ws,v.brush,v.quarters,v.origin); }
  ws.smart ??= { cells: Object.create(null), variants: Object.create(null) };
  for (const [key,v] of variants) if (v.tile) { v.id = ws.tileset.tiles.length; ws.tileset.tiles.push(v.tile); ws.smart.variants[key] = v.id; }
  if (erase) history.set(chunkIndex,layer,target.index,-1,0);
  for (const p of planned.values()) history.set(p.cell.chunk,layer,p.cell.index,p.tile ?? variants.get(p.variant!)!.id!,p.height,p.brush.id);
}
