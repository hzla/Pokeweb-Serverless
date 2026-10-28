import { mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";
import { createStudioTilesetPack, openStudioTilesetPack, saveStudioTilesetPack } from "../src/pokeweb/mapStudioTilesets";
import { studioAssert, studioPath } from "../src/pokeweb/mapStudioFormats";

// Local conversion only. No source assets are copied into the application or sent to a service.
const [sourceArg, outputArg, ...options] = process.argv.slice(2);
studioAssert(sourceArg && outputArg, 'Usage: vite-node scripts/build-map-studio-tileset.ts <folder-or-zip> <external-output.zip> [--name "Tileset name"]');
const sourcePath = realpathSync(sourceArg), outputPath = resolve(outputArg), repository = resolve(fileURLToPath(new URL("..", import.meta.url)));
mkdirSync(dirname(outputPath), { recursive: true });
const outputRelative = relative(repository, resolve(realpathSync(dirname(outputPath)), outputPath.split("/").at(-1)!));
studioAssert(outputRelative.startsWith("../"), "Keep generated tileset ZIPs outside the Pokeweb repository.");
const nameAt = options.indexOf("--name"), name = nameAt >= 0 ? options[nameAt + 1] : sourcePath.split("/").at(-1)!.replace(/\.zip$/iu, "");
const files: Record<string, Uint8Array> = Object.create(null); let total = 0;
const wanted = (path: string) => /\.(pdsts|meta|png|jpg|jpeg|bmp)$/iu.test(path);
function add(path: string, bytes: Uint8Array) {
  const normalized = studioPath(path); total += bytes.length;
  studioAssert(total <= 256 * 1024 * 1024 && !files[normalized], "Tileset source exceeds 256 MB or contains duplicate asset paths."); files[normalized] = bytes;
}
function archive(bytes: Uint8Array, prefix = "", depth = 0) {
  studioAssert(depth <= 3, "Too many nested tileset ZIPs.");
  const entries = unzipSync(bytes, { filter: f => {
    studioPath(f.name); const keep = !f.name.startsWith("__MACOSX/") && !f.name.endsWith("/") && (wanted(f.name) || extname(f.name).toLowerCase() === ".zip");
    if (keep) studioAssert(f.originalSize <= 64 * 1024 * 1024, "Tileset source entry exceeds 64 MB."); return keep;
  } });
  for (const [path, data] of Object.entries(entries)) {
    if (/\.zip$/iu.test(path)) archive(data, prefix + path.replace(/\.zip$/iu, "/"), depth + 1); else add(prefix + path, data);
  }
}
function directory(path: string, prefix = "") {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = resolve(path, entry.name), local = prefix + entry.name;
    if (entry.isDirectory()) directory(full, local + "/"); else if (entry.isFile() && wanted(local)) add(local, new Uint8Array(readFileSync(full)));
  }
}
if (statSync(sourcePath).isDirectory()) directory(sourcePath); else archive(new Uint8Array(readFileSync(sourcePath)));
const pack = createStudioTilesetPack(files, name), zip = saveStudioTilesetPack(pack), reopened = openStudioTilesetPack({ "tileset.zip": zip });
studioAssert(reopened.tileset.tiles.length === pack.tileset.tiles.length && reopened.tileset.materials.length === pack.tileset.materials.length, "Tileset ZIP round trip failed.");
writeFileSync(outputPath, zip, { flag: "wx" });
console.log(JSON.stringify({ output: outputPath, name: pack.name, sourceTilesets: pack.sourceCount, tiles: pack.tileset.tiles.length, materials: pack.tileset.materials.length, textures: Object.keys(pack.files).filter(p => p.startsWith("textures/")).length, categories: new Set(reopened.tileset.tiles.map(t => t.folder).filter(Boolean)).size, layouts: reopened.layouts?.length, bytes: zip.length, reopened: true }));
