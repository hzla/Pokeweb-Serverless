import { unzipSync, zipSync } from "fflate";

export const STUDIO_SIZE = 32, STUDIO_LAYERS = 9;
export type StudioChunk = { x: number; y: number; area: number; group: number; center: boolean; tiles: Int32Array[]; heights: Int32Array[] };
export type StudioMap = { game: number; tileset: string; chunks: StudioChunk[] };
export type StudioFace = { v: number[]; t: number[]; n: number[]; c: number[] };
export type StudioTile = {
  name: string; width: number; height: number; x: number; y: number; z: number;
  vertices: number[]; uvs: number[]; normals: number[]; colors: number[];
  triangles: StudioFace[]; quads: StudioFace[]; materials: number[]; triOffsets: number[]; quadOffsets: number[];
  globalMapping: boolean; globalScale: number; tileU: boolean; tileV: boolean;
};
export type StudioMaterial = { image: string; name: string; texture: string; palette: string; alpha: number; bothFaces: boolean; vertexColors: boolean; fog: boolean; light: boolean[]; diffuse: number[]; ambient: number[]; specular: number[]; emission: number[]; repeatU: number; repeatV: number; texGen: number };
export type StudioTileset = { tiles: StudioTile[]; materials: StudioMaterial[]; smart: number[][][] };
export type StudioWorkspace = { version: 1; mapPath: string; tilesetPath: string; files: Record<string, Uint8Array>; map: StudioMap; tileset: StudioTileset };
export function studioAssert(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }
export const newStudioChunk = (x = 0, y = 0): StudioChunk => ({ x, y, area: 0, group: 0, center: false,
  tiles: Array.from({ length: STUDIO_LAYERS }, () => new Int32Array(1024).fill(-1)), heights: Array.from({ length: STUDIO_LAYERS }, () => new Int32Array(1024)) });

export function parseStudioMap(text: string): StudioMap {
  const lines = text.replace(/^\uFEFF/u, "").split(/\r?\n/u).map(l => l.trim());
  let at = 0, chunk = newStudioChunk(), tiles = 0, heights = 0;
  const result: StudioMap = { game: -1, tileset: "", chunks: [] };
  const line = () => { studioAssert(at < lines.length, "Truncated PDSMAP project."); return lines[at++]; };
  const integer = () => { const value = Number(line()); studioAssert(Number.isSafeInteger(value), "Invalid PDSMAP number."); return value; };
  const grid = () => {
    const values = new Int32Array(1024);
    for (let y = 0; y < 32; y++) {
      const row = line().split(/\s+/u).map(Number);
      studioAssert(row.length === 32 && row.every(n => Number.isInteger(n) && n >= -2147483648 && n <= 2147483647), "PDSMAP grids require 32 rows of 32 integers.");
      values.set(row, y * 32);
    }
    return values;
  };
  while (at < lines.length) {
    const tag = line(); if (!tag || tag.startsWith("#")) continue;
    if (tag === "gameindex") result.game = integer();
    else if (tag === "tileset") result.tileset = line();
    else if (tag === "mapstart") {
      studioAssert(tiles === 0 && heights === 0, "A PDSMAP chunk is missing mapend.");
      const coords = line().split(/\s+/u).map(Number);
      studioAssert(coords.length === 2 && coords.every(n => Number.isInteger(n) && Math.abs(n) <= 65535), "Invalid PDSMAP coordinates."); chunk = newStudioChunk(coords[0], coords[1]);
    } else if (tag === "areaindex") chunk.area = integer();
    else if (tag === "exportgroup") chunk.group = integer();
    else if (tag === "egcenter") chunk.center = true;
    else if (tag === "tilegrid") { studioAssert(tiles < 9, "PDSMAP has more than nine tile layers."); chunk.tiles[tiles++] = grid(); }
    else if (tag === "heightgrid") { studioAssert(heights < 9, "PDSMAP has more than nine height layers."); chunk.heights[heights++] = grid(); }
    else if (tag === "mapend") {
      studioAssert(tiles > 0 && tiles === heights, "PDSMAP tile and height layer counts do not match.");
      result.chunks.push(chunk); chunk = newStudioChunk(); tiles = heights = 0;
    } else throw new Error(`Unsupported PDSMAP field: ${tag}.`);
  }
  if (tiles) { studioAssert(tiles === heights, "PDSMAP tile and height layer counts do not match."); result.chunks.push(chunk); }
  studioAssert(result.game >= 0 && result.game <= 8, "Unsupported PDSMS game index.");
  studioAssert(result.tileset && result.chunks.length > 0 && result.chunks.length <= 900, "Choose a PDSMAP with a tileset and 1–900 chunks.");
  studioAssert(new Set(result.chunks.map(c => `${c.x},${c.y}`)).size === result.chunks.length, "PDSMAP contains duplicate chunk coordinates.");
  return result;
}

export function writeStudioMap(map: StudioMap): string {
  const lines = ["gameindex", String(map.game), "tileset", map.tileset];
  for (const chunk of map.chunks) {
    lines.push("mapstart", `${chunk.x} ${chunk.y}`, "areaindex", String(chunk.area), "exportgroup", String(chunk.group));
    if (chunk.center) lines.push("egcenter");
    for (const [tag, grids] of [["tilegrid", chunk.tiles], ["heightgrid", chunk.heights]] as const) for (const grid of grids) {
      lines.push(tag); for (let y = 0; y < 32; y++) lines.push(Array.from(grid.subarray(y * 32, y * 32 + 32)).join(" "));
    }
    lines.push("mapend");
  }
  return lines.join("\n") + "\n";
}
export function newStudioMaterial(): StudioMaterial { return { image: "", name: "material", texture: "texture", palette: "palette", alpha: 31, bothFaces: false, vertexColors: false, fog: true, light: [true, false, false, false], diffuse: [25, 25, 25], ambient: [31, 31, 31], specular: [0, 0, 0], emission: [0, 0, 0], repeatU: 0, repeatV: 0, texGen: 0 }; }
function newTile(): StudioTile { return { name: "", width: 1, height: 1, x: 0, y: 0, z: 0, vertices: [], uvs: [], normals: [], colors: [1, 1, 1], triangles: [], quads: [], materials: [], triOffsets: [], quadOffsets: [], globalMapping: false, globalScale: 1, tileU: true, tileV: true }; }

/** PDSTS uses big-endian Java integers/floats, unlike the native DS binaries. */
export function parseStudioTileset(bytes: Uint8Array): StudioTileset {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); let at = 0, tile: StudioTile | undefined, material: StudioMaterial | undefined;
  const result: StudioTileset = { tiles: [], materials: [], smart: [] };
  const int = () => { studioAssert(at + 4 <= bytes.length, "Truncated PDSTS tileset."); const n = view.getInt32(at); at += 4; return n; };
  const size = () => { const n = int(); studioAssert(n >= 0 && n <= 4_000_000, "Invalid PDSTS array size."); return n; };
  const scalar = () => { studioAssert(size() === 1, "Invalid PDSTS scalar."); return int(); };
  const floats = (allowNonfinite = false) => { const n = size(); studioAssert(at + n * 4 <= bytes.length, "Truncated PDSTS geometry."); const list = Array.from({ length: n }, () => { const f = view.getFloat32(at); at += 4; studioAssert(allowNonfinite || Number.isFinite(f), "Invalid PDSTS coordinate."); return f; }); return list; };
  const ints = () => Array.from({ length: size() }, int);
  const string = () => { const n = size(); studioAssert(at + n <= bytes.length, "Truncated PDSTS name."); const s = new TextDecoder().decode(bytes.subarray(at, at + n)); at += n; return s; };
  const faces = (count: number, extended: boolean) => Array.from({ length: size() }, (): StudioFace => ({ v: Array.from({ length: count }, int), t: Array.from({ length: count }, int), n: Array.from({ length: count }, int), c: extended ? Array.from({ length: count }, int) : Array(count).fill(1) }));
  const strings: Record<number, keyof StudioMaterial> = { 1: "image", 2: "palette", 3: "texture", 4: "name" };
  const materialInts: Record<number, keyof StudioMaterial> = { 30: "fog", 31: "bothFaces", 33: "alpha", 34: "texGen", 40: "repeatU", 41: "repeatV", 48: "vertexColors" };
  const flags = new Set([30, 31, 48]);
  const arrays: Record<number, keyof StudioTile> = { 15: "vertices", 16: "uvs", 22: "normals", 49: "colors" };
  const offsets: Record<number, keyof StudioTile> = { 19: "materials", 24: "quadOffsets", 25: "triOffsets" };
  const tileFlags: Record<number, keyof StudioTile> = { 36: "tileU", 37: "tileV", 27: "globalMapping" };
  while (at < bytes.length) {
    const tag = bytes[at++];
    if (tag === 9) { scalar(); material = newStudioMaterial(); }
    else if (tag === 10) { scalar(); studioAssert(material, "PDSTS material has no start."); result.materials.push(material); material = undefined; }
    else if (strings[tag]) { studioAssert(material, "PDSTS material field outside a material."); (material as any)[strings[tag]] = string(); }
    else if (materialInts[tag]) { studioAssert(material, "PDSTS material field outside a material."); const n = scalar(); (material as any)[materialInts[tag]] = flags.has(tag) ? n !== 0 : n; }
    else if (tag >= 43 && tag <= 46) { studioAssert(material, "PDSTS light outside a material."); material.light[tag - 43] = scalar() !== 0; }
    else if (tag >= 53 && tag <= 56) { studioAssert(material, "PDSTS color outside a material."); const n = size(); studioAssert(n === 3 && at + n <= bytes.length, "Invalid PDSTS material color."); const rgb = Array.from(bytes.subarray(at, at + 3)); at += 3; (material as any)[["diffuse", "ambient", "specular", "emission"][tag - 53]] = rgb; }
    else if ([32, 35, 42, 47].includes(tag)) scalar();
    else if (tag === 26) result.smart.push(Array.from({ length: size() }, ints));
    else if (tag === 0) { scalar(); tile = newTile(); result.tiles.push(tile); }
    else {
      studioAssert(tile, "PDSTS tile field outside a tile.");
      // Some desktop tilesets retain NaNs in unused UVs/normals. Keep the source
      // bytes intact; only a drawn invalid UV prevents native compilation.
      if (arrays[tag]) (tile as any)[arrays[tag]] = floats(tag === 16 || tag === 22);
      else if (offsets[tag]) (tile as any)[offsets[tag]] = ints();
      else if (tileFlags[tag]) (tile as any)[tileFlags[tag]] = scalar() !== 0;
      else if (tag === 11 || tag === 12) tile[tag === 11 ? "width" : "height"] = scalar();
      else if ([23, 28, 38, 39].includes(tag)) { const values = floats(); studioAssert(values.length === 1, "Invalid PDSTS offset."); (tile as any)[({ 23: "z", 28: "globalScale", 38: "x", 39: "y" } as Record<number, string>)[tag]] = values[0]; }
      else if (tag === 13 || tag === 14) scalar();
      else if ([17, 18, 50, 51].includes(tag)) tile[tag === 17 || tag === 50 ? "quads" : "triangles"] = faces(tag === 17 || tag === 50 ? 4 : 3, tag >= 50);
      else if (tag === 21) tile.name = string();
      else throw new Error(`Unsupported PDSTS field ${tag}; the original file has been kept intact.`);
    }
  }
  studioAssert(result.tiles.length > 0 && result.materials.length > 0, "The PDSTS tileset has no tiles or materials.");
  for (const t of result.tiles) {
    studioAssert(t.width > 0 && t.height > 0 && t.width <= 32 && t.height <= 32 && t.vertices.length % 3 === 0 && t.uvs.length % 2 === 0, "Invalid PDSTS tile dimensions or geometry.");
    for (const f of [...t.quads, ...t.triangles]) studioAssert(f.v.every(i => i > 0 && i * 3 <= t.vertices.length) && f.t.every(i => i === 0 || i * 2 <= t.uvs.length) && f.n.every(i => i === 0 || i * 3 <= t.normals.length), "PDSTS face references missing geometry.");
    studioAssert(t.materials.every(i => i >= 0 && i < result.materials.length), "PDSTS tile references a missing material.");
  }
  return result;
}

/** User-selected bytes only: project references are never fetched from the network. */
export function studioPath(path: string): string {
  studioAssert(!/^(?:[a-z]+:|\/)/iu.test(path), "Choose local project assets using relative paths.");
  const parts: string[] = [];
  for (const part of path.replace(/\\/gu, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") { studioAssert(parts.length > 0, "Project path escapes the selected bundle."); parts.pop(); } else parts.push(part);
  }
  return parts.join("/");
}
export function findStudioAsset(files: Record<string, Uint8Array>, from: string, name: string): string {
  const relative = studioPath(from.split("/").slice(0, -1).concat(name.replace(/\\/gu, "/")).join("/"));
  if (files[relative]) return relative;
  const matches = Object.keys(files).filter(path => path.split("/").at(-1)?.toLowerCase() === name.replace(/\\/gu, "/").split("/").at(-1)?.toLowerCase());
  studioAssert(matches.length === 1, matches.length ? `Several assets match ${name}; retain their project folders.` : `Missing ${name}. Open the project folder or a ZIP with its tileset and textures.`);
  return matches[0];
}
export function openStudioWorkspace(input: Record<string, Uint8Array>): StudioWorkspace {
  const files: Record<string, Uint8Array> = Object.create(null);
  for (const [path, bytes] of Object.entries(input)) {
    if (path.toLowerCase().endsWith(".zip")) {
      let total = 0;
      const entries = unzipSync(bytes, { filter: f => { total += f.originalSize; studioAssert(f.originalSize <= 64 * 1024 * 1024 && total <= 256 * 1024 * 1024, "Project ZIP exceeds the 256 MB limit."); return !f.name.endsWith("/"); } });
      for (const [name, data] of Object.entries(entries)) files[studioPath(name)] = data;
    } else files[studioPath(path)] = bytes;
  }
  const maps = Object.keys(files).filter(p => p.toLowerCase().endsWith(".pdsmap"));
  studioAssert(maps.length === 1, "Open one PDSMAP project together with its PDSTS tileset, textures and sidecars (or a ZIP/folder containing them).");
  const mapPath = maps[0], map = parseStudioMap(new TextDecoder().decode(files[mapPath]));
  const tilesetPath = findStudioAsset(files, mapPath, map.tileset), tileset = parseStudioTileset(files[tilesetPath]);
  for (const c of map.chunks) for (const grid of c.tiles) studioAssert(grid.every(id => id >= -1 && id < tileset.tiles.length), "PDSMAP references tiles that are absent from its tileset.");
  const meta = files[tilesetPath + ".meta"];
  if (meta) for (const line of new TextDecoder().decode(meta).split(/\r?\n/u)) {
    const fields = line.split("|"); if (fields[0] === "tile" && tileset.tiles[Number(fields[1])]) tileset.tiles[Number(fields[1])].name = fields[2].replace(/\\p/gu, "|").replace(/\\n/gu, " ") || tileset.tiles[Number(fields[1])].name;
  }
  return { version: 1, mapPath, tilesetPath, files, map, tileset };
}
export function saveStudioWorkspace(workspace: StudioWorkspace): Uint8Array {
  return zipSync({ ...workspace.files, [workspace.mapPath]: new TextEncoder().encode(writeStudioMap(workspace.map)) }, { level: 3 });
}
export function studioPerName(workspace: StudioWorkspace, chunk: StudioChunk, secondary = false): string {
  const minX = Math.min(...workspace.map.chunks.map(c => c.x)), minY = Math.min(...workspace.map.chunks.map(c => c.y));
  return workspace.mapPath.replace(/\.pdsmap$/iu, "") + (secondary ? "2" : "") + `_${String(chunk.x - minX).padStart(2, "0")}_${String(chunk.y - minY).padStart(2, "0")}.per`;
}
