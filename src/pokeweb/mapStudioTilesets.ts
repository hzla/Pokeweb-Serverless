import { zipSync } from "fflate";
import { findStudioAsset, newStudioChunk, parseStudioTileset, readStudioLayouts, readStudioTilesetMetadata, studioAssert, studioPath, unpackStudioFiles, type StudioPalette, type StudioTileLayout, type StudioTileset, type StudioWorkspace } from "./mapStudioFormats";
import { deriveStudioLayouts, remapStudioLayouts } from "./mapStudioPalette";

const encoder = new TextEncoder(), decoder = new TextDecoder();
const MANIFEST = "mapstudio-tileset.json";
export type StudioTilesetPack = { name: string; tilesetPath: string; tileset: StudioTileset; files: Record<string, Uint8Array>; sourceCount: number; layouts?: StudioTileLayout[] };

export { writeStudioTileset } from "./mapStudioTilesetWriter";
import { writeStudioTileset } from "./mapStudioTilesetWriter";

const escapeMeta = (text: string) => text.replace(/\\/gu, "\\\\").replace(/\|/gu, "\\p").replace(/\r?\n/gu, "\\n");
const prefixFolder = (prefix: string, folder: string) => [escapeMeta(prefix), folder].filter(Boolean).join("/");
type MetadataSource = { tileset: StudioTileset; bytes?: Uint8Array; prefix: string; start: number; smartStart: number };
function combineMetadata(sources: MetadataSource[]): Uint8Array {
  const lines = ["# Pokemon DS Map Studio tile metadata v7"];
  for (const source of sources) {
    const named = new Set<number>();
    if (source.prefix) lines.push(`folder|${escapeMeta(source.prefix)}|8|4|0|0|1|0|0`);
    for (const line of decoder.decode(source.bytes).split(/\r?\n/u)) {
      const f = line.split("|");
      if (f[0] === "folder" && f.length >= 3) f[1] = prefixFolder(source.prefix, f[1]);
      else if (["tile", "membership"].includes(f[0]) && Number.isInteger(Number(f[1])) && source.tileset.tiles[Number(f[1])]) {
        const index = Number(f[1]); f[1] = String(index + source.start);
        if (f[0] === "tile" && f.length >= 4) { f[3] = prefixFolder(source.prefix, f[3]); named.add(index); }
        else if (f[0] === "membership" && f.length >= 3) f[2] = prefixFolder(source.prefix, f[2]); else continue;
      } else if (f[0] === "smart" && source.tileset.smart[Number(f[1])] && f.length >= 3) { f[1] = String(Number(f[1]) + source.smartStart); f[2] = prefixFolder(source.prefix, f[2]); }
      else continue;
      lines.push(f.join("|"));
    }
    for (const [index, tile] of source.tileset.tiles.entries()) if (!named.has(index)) lines.push(`tile|${source.start + index}|${escapeMeta(tile.name)}|${prefixFolder(source.prefix, escapeMeta(tile.folder || ""))}|-1|0|0`);
  }
  return encoder.encode(lines.join("\n") + "\n");
}

/** Build one portable library. Only referenced texture bytes and tile metadata are included. */
export function createStudioTilesetPack(input: Record<string, Uint8Array>, name: string): StudioTilesetPack {
  const source = unpackStudioFiles(input), paths = Object.keys(source).filter(p => p.toLowerCase().endsWith(".pdsts")).sort();
  studioAssert(paths.length > 0 && paths.length <= 128, "Choose a tileset ZIP/folder containing 1–128 PDSTS files and their textures.");
  const tileset: StudioTileset = { tiles: [], materials: [], smart: [] }, files: Record<string, Uint8Array> = Object.create(null), metadata: MetadataSource[] = [];
  for (const [index, path] of paths.entries()) {
    const set = parseStudioTileset(source[path]), start = tileset.tiles.length, materialStart = tileset.materials.length, smartStart = tileset.smart.length;
    const meta = source[path + ".meta"]; readStudioTilesetMetadata(set, meta);
    const prefix = paths.length > 1 ? path.split("/").slice(0, -1).at(-1) || path.split("/").at(-1)!.replace(/\.pdsts$/iu, "") : "";
    metadata.push({ tileset: set, bytes: meta, prefix, start, smartStart });
    const textures = new Map<string, string>();
    for (const material of set.materials) {
      const sourcePath = findStudioAsset(source, path, material.image);
      let target = textures.get(sourcePath);
      if (!target) { target = `textures/${index}/${textures.size}-${sourcePath.split("/").at(-1)}`; files[target] = source[sourcePath]; textures.set(sourcePath, target); }
      tileset.materials.push({ ...material, image: target });
    }
    for (const t of set.tiles) tileset.tiles.push({ ...t, materials: t.materials.map(id => id + materialStart) });
    for (const smart of set.smart) tileset.smart.push(smart.map(column => column.map(id => id >= 0 ? id + start : id)));
  }
  files["tileset.pdsts"] = writeStudioTileset(tileset); files["tileset.pdsts.meta"] = combineMetadata(metadata);
  readStudioTilesetMetadata(tileset, files["tileset.pdsts.meta"]);
  const pack = { name: name.trim() || "Imported tileset", tilesetPath: "tileset.pdsts", tileset, files, sourceCount: paths.length, layouts: deriveStudioLayouts(tileset, files["tileset.pdsts.meta"]) };
  files[MANIFEST] = encoder.encode(JSON.stringify({ format: "pokeweb-map-studio-tileset", version: 1, name: pack.name, tileset: pack.tilesetPath, sourceCount: paths.length }, null, 2));
  return pack;
}
export function saveStudioTilesetPack(pack: StudioTilesetPack, includeLayouts = true): Uint8Array {
  const path = pack.tilesetPath + ".layouts.json", files = { ...pack.files }; delete files[path];
  if (includeLayouts && pack.layouts) files[path] = encoder.encode(JSON.stringify(pack.layouts));
  return zipSync(files, { level: 6, mtime: new Date(1980, 0, 1) });
}

export function openStudioTilesetPack(input: Record<string, Uint8Array>, fallbackName = "Imported tileset"): StudioTilesetPack {
  const files = unpackStudioFiles(input), manifestPath = Object.keys(files).find(p => p.split("/").at(-1) === MANIFEST);
  if (!manifestPath) return createStudioTilesetPack(files, fallbackName);
  const manifest = JSON.parse(decoder.decode(files[manifestPath]));
  studioAssert(manifest?.format === "pokeweb-map-studio-tileset" && manifest.version === 1 && typeof manifest.name === "string" && typeof manifest.tileset === "string", "Unsupported Map Studio tileset pack.");
  const tilesetPath = findStudioAsset(files, manifestPath, manifest.tileset), tileset = parseStudioTileset(files[tilesetPath]);
  readStudioTilesetMetadata(tileset, files[tilesetPath + ".meta"]);
  for (const material of tileset.materials) findStudioAsset(files, tilesetPath, material.image);
  const layouts = files[tilesetPath + ".layouts.json"] ? readStudioLayouts(files[tilesetPath + ".layouts.json"], tileset.tiles.length) : deriveStudioLayouts(tileset, files[tilesetPath + ".meta"]);
  return { name: manifest.name, tilesetPath, tileset, files, layouts, sourceCount: Number.isInteger(manifest.sourceCount) ? manifest.sourceCount : 1 };
}

function relativeStudioPath(from: string, to: string): string {
  const a = from.split("/").slice(0, -1), b = to.split("/");
  while (a.length && b.length && a[0] === b[0]) { a.shift(); b.shift(); }
  return [...a.map(() => ".."), ...b].join("/");
}

/** Append IDs, never replace existing IDs: painted cells and their undo history remain valid. */
export function attachStudioTileset(workspace: StudioWorkspace | undefined, pack: StudioTilesetPack, id: string, game = 8): { workspace: StudioWorkspace; palette: StudioPalette } {
  studioAssert(/^[a-z0-9-]{1,80}$/u.test(id), "Invalid tileset library ID.");
  const existing = workspace?.palettes?.find(p => p.id === id);
  if (workspace && existing) return { workspace, palette: existing };
  const mapPath = workspace?.mapPath ?? "Untitled.pdsmap", base = mapPath.split("/").slice(0, -1).join("/");
  const assetRoot = [base, "mapstudio-tilesets", id].filter(Boolean).join("/");
  const files = { ...workspace?.files };
  const tilesetPath = workspace?.tilesetPath ?? `${assetRoot}/tileset.pdsts`;
  const old = workspace?.tileset ?? { tiles: [], materials: [], smart: [] }, start = old.tiles.length, materialStart = old.materials.length;
  const materialFiles = new Map<string, string>();
  const materials = pack.tileset.materials.map(m => {
    const path = findStudioAsset(pack.files, pack.tilesetPath, m.image);
    let target = materialFiles.get(path);
    if (!target) { target = `${assetRoot}/textures/${materialFiles.size}-${path.split("/").at(-1)}`; files[target] = pack.files[path]; materialFiles.set(path, target); }
    return { ...m, image: relativeStudioPath(tilesetPath, target) };
  });
  const tileset: StudioTileset = { tiles: [...old.tiles, ...pack.tileset.tiles.map(t => ({ ...t, materials: t.materials.map(m => m + materialStart) }))], materials: [...old.materials, ...materials], smart: [...old.smart, ...pack.tileset.smart.map(grid => grid.map(column => column.map(n => n >= 0 ? n + start : n)))] };
  const palette: StudioPalette = { id, name: pack.name, start, count: pack.tileset.tiles.length };
  // Keep the project's tileset path so original relative texture references and sidecars stay valid.
  files[tilesetPath] = writeStudioTileset(tileset);
  files[tilesetPath + ".meta"] = combineMetadata([{ tileset: old, bytes: workspace?.files[tilesetPath + ".meta"], prefix: "", start: 0, smartStart: 0 }, { tileset: pack.tileset, bytes: pack.files[pack.tilesetPath + ".meta"], prefix: pack.name, start, smartStart: old.smart.length }]);
  readStudioTilesetMetadata(tileset, files[tilesetPath + ".meta"]);
  const layouts = [...workspace?.layouts ?? deriveStudioLayouts(old, workspace?.files[tilesetPath + ".meta"]), ...remapStudioLayouts(pack.layouts ?? deriveStudioLayouts(pack.tileset, pack.files[pack.tilesetPath + ".meta"]), start, id + "/", pack.name)];
  const result: StudioWorkspace = { version: 1, mapPath, tilesetPath, files, tileset, layouts, ...(workspace?.smart ? { smart: workspace.smart } : {}), map: workspace?.map ?? { game, tileset: studioPath(tilesetPath), chunks: [newStudioChunk()] }, palettes: [...workspace?.palettes ?? [], palette] };
  return { workspace: result, palette };
}
