import { readFileSync } from "node:fs";
import { attachStudioTileset, openStudioTilesetPack } from "../src/pokeweb/mapStudioTilesets";
import { findStudioAsset, openStudioWorkspace, saveStudioWorkspace, studioAssert, type StudioWorkspace } from "../src/pokeweb/mapStudioFormats";
import { StudioHistory } from "../src/pokeweb/mapStudioModel";

studioAssert(process.argv.length > 2, "Usage: vite-node scripts/verify-map-studio-tilesets.ts <tileset.zip> [...tileset.zip]");
let workspace: StudioWorkspace | undefined;
const summaries: unknown[] = [];
for (const [index, path] of process.argv.slice(2).entries()) {
  const pack = openStudioTilesetPack({ "pack.zip": new Uint8Array(readFileSync(path)) });
  const result = attachStudioTileset(workspace, pack, `pack-${index}`); workspace = result.workspace;
  for (const [materialIndex, material] of pack.tileset.materials.entries()) {
    const source = pack.files[findStudioAsset(pack.files, pack.tilesetPath, material.image)], appended = workspace.tileset.materials[workspace.tileset.materials.length - pack.tileset.materials.length + materialIndex];
    const destination = workspace.files[findStudioAsset(workspace.files, workspace.tilesetPath, appended.image)];
    studioAssert(Buffer.from(source).equals(Buffer.from(destination)), "Imported texture bytes changed.");
  }
  const layer = index % 9, history = new StudioHistory(workspace); history.paint(0, layer, 0, 0, result.palette.start, 0, "paint"); history.finish(); history.undo(); history.redo();
  studioAssert(workspace.map.chunks[0].tiles[layer][0] === result.palette.start, "Imported tile could not be painted or undone.");
  studioAssert(attachStudioTileset(workspace, pack, `pack-${index}`).workspace === workspace, "Duplicate tileset was appended.");
  summaries.push({ name: pack.name, sourceTilesets: pack.sourceCount, tiles: pack.tileset.tiles.length, materials: pack.tileset.materials.length, layouts: pack.layouts?.length, textureBytesPreserved: true, paintUndoRedo: true });
}
const saved = saveStudioWorkspace(workspace!), reopened = openStudioWorkspace({ "saved.zip": saved });
studioAssert(reopened.tileset.tiles.length === workspace!.tileset.tiles.length && reopened.tileset.materials.length === workspace!.tileset.materials.length && JSON.stringify(reopened.palettes) === JSON.stringify(workspace!.palettes), "Saved library references changed.");
studioAssert(JSON.stringify(reopened.map) === JSON.stringify(workspace!.map), "Saved map cells changed.");
studioAssert(JSON.stringify(reopened.layouts) === JSON.stringify(workspace!.layouts), "Saved tile arrangements changed.");
for (let i = 0; i < workspace!.tileset.tiles.length; i++) {
  const a = workspace!.tileset.tiles[i], b = reopened.tileset.tiles[i];
  studioAssert(a.name === b.name && a.folder === b.folder && JSON.stringify(a.materials) === JSON.stringify(b.materials) && JSON.stringify(a.vertices) === JSON.stringify(b.vertices) && JSON.stringify(a.uvs) === JSON.stringify(b.uvs), "Saved tile geometry or metadata changed.");
}
for (const [path, data] of Object.entries(workspace!.files)) if (path !== workspace!.mapPath) studioAssert(Buffer.from(reopened.files[path]).equals(Buffer.from(data)), "Saved asset bytes changed.");
console.log(JSON.stringify({ packs: summaries, combinedTiles: reopened.tileset.tiles.length, projectSaveReopen: true, categories: new Set(reopened.tileset.tiles.map(t => t.folder).filter(Boolean)).size, savedBytes: saved.length }));
