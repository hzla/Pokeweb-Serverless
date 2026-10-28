// Local verification only. Source ROMs and user saves are never written.
import { readFile, writeFile, readdir } from "node:fs/promises";
import { basename } from "node:path";
import assert from "node:assert/strict";
import { studioFixture } from "../src/test/fixtures/mapStudio";
import { saveStudioWorkspace, openStudioWorkspace } from "../src/pokeweb/mapStudioFormats";
import { StudioHistory } from "../src/pokeweb/mapStudioModel";
import { compileStudioChunk } from "../src/pokeweb/mapStudioCompiler";
import { loadProjectFromRomBytes } from "../src/pokeweb/loader";
import { loadMap3dZone } from "../src/pokeweb/map3dModel";
import { prepareGen5MapImport, applyGen5MapImport, undoGen5MapImport } from "../src/pokeweb/gen5MapImport";
import { exportModifiedRom } from "../src/pokeweb/exportRom";
import { createProjectDocument } from "../src/pokeweb/projectDocument";
import { openProjectSession } from "../src/pokeweb/projectSession";
const sourcePath = process.argv[2], bundlePath = process.argv[3];
if (sourcePath === "--inspect-project") {
  const directory = bundlePath, files: Record<string, Uint8Array> = Object.create(null);
  assert(directory, "Pass the local PDSMS project directory.");
  for (const name of await readdir(directory)) if (!name.startsWith(".")) files[name] = new Uint8Array(await readFile(`${directory}/${name}`));
  const original = openStudioWorkspace(files), saved = saveStudioWorkspace(original), reopened = openStudioWorkspace({ "saved.zip": saved });
  assert.deepEqual(reopened.map, original.map); assert.deepEqual(reopened.tileset, original.tileset);
  if (process.argv[4]) await writeFile(process.argv[4], saved);
  console.log(JSON.stringify({ project: original.mapPath, game: original.map.game, chunks: original.map.chunks.length, tiles: original.tileset.tiles.length, materials: original.tileset.materials.length, assets: Object.keys(files).length, saveReopen: true })); process.exit(0);
}
const ws = studioFixture(), history = new StudioHistory(ws);
// A small textured plateau with a separate decoration layer.
for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) history.paint(0, 0, x, y, 0, x > 3 && y > 3 ? 2 : 0, "paint");
history.finish(); const painted = ws.map.chunks[0].tiles[0].slice(); history.undo(); history.redo(); assert.deepEqual(ws.map.chunks[0].tiles[0], painted);
const zip = saveStudioWorkspace(ws); assert.deepEqual(openStudioWorkspace({ "verify.zip": zip }).map, ws.map);
if (bundlePath) await writeFile(bundlePath, zip);
if (!sourcePath || sourcePath === "--bundle-only") { console.log("Map Studio bundle, paint, undo/redo and save/reopen passed."); process.exit(0); }
const source = new Uint8Array(await readFile(sourcePath)), project = await loadProjectFromRomBytes(source, basename(sourcePath), { selectedNarcs: ["headers", "maps"] });
ws.map.game = project.session.baseRom === "BW" ? 5 : 8;
const zone = project.session.baseRom === "BW" ? 3 : 427;
const before = await loadMap3dZone(project, zone, { season: "spring" });
const selected = before.chunks[0]; assert(selected, "native scene contains an insertion destination");
const input = compileStudioChunk(ws, 0, 0), result = await prepareGen5MapImport(project, input, { matrixId: before.sourceMatrixId, x: selected.matrixX, y: selected.matrixY, headerId: zone, season: "spring" });
const original = project.narcs.maps!.rawFiles.map(b => b.slice());
await applyGen5MapImport(project, result); assert.equal(project.narcs.maps!.rawFiles.length > original.length, true);
const reopened = openProjectSession(structuredClone(createProjectDocument(project, false)));
assert.deepEqual(reopened.narcs.maps!.rawFiles[result.mapId], project.narcs.maps!.rawFiles[result.mapId]);
const exported = await exportModifiedRom(project), reloaded = await loadProjectFromRomBytes(exported, "map-studio-verification.nds", { selectedNarcs: ["headers", "maps"] });
const scene = await loadMap3dZone(reloaded, zone, { season: "spring" }), imported = scene.chunks.find(c => c.chunkId === result.mapId);
assert(imported && imported.primitives.some(p => p.material.texture), "ROM reload reproduces imported texture bindings");
assert(imported.primitives.some(p => p.positions.some((n, i) => i % 3 === 1 && Math.abs(n - 32) < 0.01)), "authored two-tile plateau survives native export");
await undoGen5MapImport(project, result); assert.deepEqual(project.narcs.maps!.rawFiles, original);
console.log(JSON.stringify({ game: project.session.baseRom, nativeCompilation: true, walkingHeights: true, projectReopen: true, romExportReload: true, undo: true, mapId: result.mapId, renderedPrimitives: imported.primitives.length }));
