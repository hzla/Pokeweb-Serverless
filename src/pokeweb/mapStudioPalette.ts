import { studioAssert, type StudioPalette, type StudioTileLayout, type StudioTileset } from "./mapStudioFormats";

const decode = (text: string) => text.replace(/\\([\\pn])/gu, (_, c: string) => c === "p" ? "|" : c === "n" ? " " : "\\");
const title = (text: string) => text.replace(/\.obj$/iu, "").replace(/[_-]+/gu, " ").trim().replace(/^./u, c => c.toUpperCase());
function commonFolder(tileset: StudioTileset, ids: number[]) {
  const counts = new Map<string, number>(); for (const id of ids) if (id >= 0) { const f = tileset.tiles[id]?.folder || ""; counts.set(f, (counts.get(f) || 0) + 1); }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
}
function layoutName(tileset: StudioTileset, cells: number[]) {
  const center = cells[4] >= 0 ? cells[4] : cells.find(id => id >= 0)!;
  const name = title(tileset.tiles[center]?.name || "Terrain"), edges = cells.filter((_, i) => i !== 4).map(id => tileset.tiles[id]?.name || "").join(" ");
  return /cliff|mountain|rock_/iu.test(edges) && !/cliff|mountain/iu.test(name) ? `${name} · cliffs` : name;
}
function role(name: string) {
  const n = name.toLowerCase().replace(/\.obj$/u, "");
  if (/corner.?in|inner|concave|_c$/u.test(n)) return "inner";
  if (/corner|_c[bt][lr]|_[bt][lr](?:_|$)/u.test(n)) return "corner";
  if (/side|straight|_edge|_[btrl](?:_|$)/u.test(n)) return "edge";
  return "fill";
}
function family(name: string) {
  return name.toLowerCase().replace(/\.obj$/u, "").replace(/corner.?out|corner.?in|corner|straight|side|inner|outer|center|centre|_c[bt][lr]|_[btrl](?=_|$)/gu, " ").replace(/(?:^|[_ -])(?:ul|ur|dl|dr|tl|tr|bl|br|nw|ne|sw|se|left|right|top|bottom)(?=$|[_ -])/gu, " ").replace(/[_ -]+/gu, " ").replace(/\d+/gu, "").trim().replace(/ water$/u, "");
}

/** Recover authored smart grids first, then only unambiguous corner/edge/fill patterns. */
export function deriveStudioLayouts(tileset: StudioTileset, metadata?: Uint8Array): StudioTileLayout[] {
  const layouts: StudioTileLayout[] = [], used = new Set<number>(), keys = new Set<string>();
  const folders = new Map<number, string>(), columns = new Map<string, number>(), placements = new Map<string, Map<number, number>>();
  for (const line of new TextDecoder().decode(metadata).split(/\r?\n/u)) {
    const f = line.split("|");
    if (f[0] === "smart" && f.length >= 3) folders.set(Number(f[1]), decode(f[2]));
    if (f[0] === "folder") { const n = Number(f[2]); if (Number.isInteger(n) && n > 0 && n <= 64) columns.set(decode(f[1]), n); }
    if ((f[0] === "tile" && f.length >= 5) || (f[0] === "membership" && f.length >= 4)) {
      const index = Number(f[1]), folder = decode(f[f[0] === "tile" ? 3 : 2]), slot = Number(f[f[0] === "tile" ? 4 : 3]);
      if (tileset.tiles[index] && Number.isInteger(slot) && slot >= 0 && slot <= 65535) { let map = placements.get(folder); if (!map) placements.set(folder, map = new Map()); if (!map.has(slot)) map.set(slot, index); }
    }
  }
  const add = (layout: StudioTileLayout) => {
    if (!layout.cells.some(id => id >= 0)) return;
    const key = `${layout.columns}:${layout.cells.join(",")}`; if (keys.has(key)) return; keys.add(key);
    layouts.push(layout); for (const id of [...layout.cells, ...layout.extras || []]) if (id >= 0) used.add(id);
  };
  for (const [index, grid] of tileset.smart.entries()) {
    if (grid.length < 3 || grid.slice(0, 3).some(c => c.length < 3)) continue;
    const valid = (id: number | undefined) => Number.isInteger(id) && id! >= 0 && id! < tileset.tiles.length ? id! : -1;
    // Desktop thumbnails use source Y-up; the terrain viewport projects Y-down.
    // Reverse the authored rows so the actual tile geometry joins in this view.
    const cells = Array.from({ length: 9 }, (_, i) => valid(grid[i % 3]?.[2 - Math.floor(i / 3)]));
    const extras = [valid(grid[3]?.[1]), valid(grid[4]?.[1]), valid(grid[3]?.[0]), valid(grid[4]?.[0])];
    add({ id: `smart-${index}`, name: layoutName(tileset, cells), folder: folders.get(index) || commonFolder(tileset, cells), columns: 3, rows: 3, cells, ...(extras.some(id => id >= 0) ? { extras } : {}), source: "smart" });
  }
  const signatures = tileset.tiles.map(t => t.materials.map(id => tileset.materials[id]?.image).sort().join("|"));
  const roles = tileset.tiles.map(t => role(t.name)), families = tileset.tiles.map(t => family(t.name));
  const expected = ["corner", "edge", "corner", "edge", "fill", "edge", "corner", "edge", "corner"];
  function pattern(ids: number[], id: string, source: "metadata" | "inferred", folder: string) {
    if (ids.some(n => n < 0 || !tileset.tiles[n]) || ids.filter(n => !used.has(n)).length < 3) return;
    const first = ids[0], f = families[first]; if (!f || f.length < 3) return;
    if (!ids.every((n, i) => roles[n] === expected[i] && families[n] === f && tileset.tiles[n].width === 1 && tileset.tiles[n].height === 1 && (i === 4 || signatures[n] === signatures[ids[expected[i] === "corner" ? 0 : 1]]) && tileset.tiles[n].folder === tileset.tiles[first].folder)) return;
    add({ id, name: title(tileset.tiles[ids[4]].name), folder, columns: 3, rows: 3, cells: [...ids.slice(6,9), ...ids.slice(3,6), ...ids.slice(0,3)], source });
  }
  for (const [folder, slots] of placements) {
    const width = columns.get(folder); if (!width || width < 3) continue;
    for (const [slot, tile] of slots) if (roles[tile] === "corner" && slot % width <= width - 3) pattern(Array.from({ length: 9 }, (_, i) => slots.get(slot + i % 3 + Math.floor(i / 3) * width) ?? -1), `metadata-${layouts.length}-${tile}`, "metadata", folder);
  }
  for (let start = 0; start < tileset.tiles.length; start++) if (roles[start] === "corner") for (const stride of [3, 4, 5, 6, 8, 10, 12, 16]) {
    const before = layouts.length;
    pattern(Array.from({ length: 9 }, (_, i) => start + i % 3 + Math.floor(i / 3) * stride), `inferred-${start}`, "inferred", tileset.tiles[start].folder || "");
    if (layouts.length > before) break;
  }
  // Distinguish texture variants with the same source name, without changing tile IDs.
  const totals = new Map<string, number>(), seen = new Map<string, number>();
  for (const g of layouts) totals.set(g.name, (totals.get(g.name) || 0) + 1);
  for (const g of layouts) if (totals.get(g.name)! > 1) { const n = (seen.get(g.name) || 0) + 1; seen.set(g.name, n); g.name += ` · ${n}`; }
  return layouts;
}

export function resizeStudioLayout(layout: StudioTileLayout, columns: number, rows: number): StudioTileLayout {
  studioAssert(Number.isInteger(columns) && columns > 0 && columns <= 16 && Number.isInteger(rows) && rows > 0 && rows <= 16, "Use layout dimensions from 1 to 16.");
  return { ...layout, columns, rows, cells: Array.from({ length: columns * rows }, (_, i) => i % columns < layout.columns && Math.floor(i / columns) < layout.rows ? layout.cells[Math.floor(i / columns) * layout.columns + i % columns] : -1) };
}
export function remapStudioLayouts(layouts: StudioTileLayout[], offset: number, prefix = "", folderPrefix = ""): StudioTileLayout[] {
  return layouts.map(g => ({ ...g, id: prefix + g.id, folder: [folderPrefix, g.folder].filter(Boolean).join("/"), cells: g.cells.map(id => id < 0 ? -1 : id + offset), ...(g.extras ? { extras: g.extras.map(id => id < 0 ? -1 : id + offset) } : {}) }));
}
export function layoutWithinPalette(layout: StudioTileLayout, palette: StudioPalette) {
  return [...layout.cells, ...layout.extras || []].every(id => id < 0 || id >= palette.start && id < palette.start + palette.count);
}
export function layoutTileIds(layout: StudioTileLayout) { return [...layout.cells, ...layout.extras || []].filter(id => id >= 0); }
