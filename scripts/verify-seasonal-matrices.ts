// In-memory checks only: never modify source ROMs or user saves.
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import assert from "node:assert/strict";
import { NARC } from "../src/nds/narc";
import { NintendoDSRom } from "../src/nds/rom";
import { loadProjectFromRomBytes } from "../src/pokeweb/loader";
import { exportModifiedRom } from "../src/pokeweb/exportRom";
import { createProjectDocument } from "../src/pokeweb/projectDocument";
import { openProjectSession } from "../src/pokeweb/projectSession";
import { duplicateMatrix, getMatrixSnapshot, linkHeaderToMatrix, loadMatrixEditorData, resolveMatrixCellGraphicsHeader } from "../src/pokeweb/matrixModel";
import { getMapReplacementBytes, getSeasonalAssignment, materializeMapReplacementFile, parseMapReplacementFile, replacementRules, resolveSeasonalMatrix, setSeasonalAssignment } from "../src/pokeweb/seasonalMatrixModel";
import { loadMap3dZone } from "../src/pokeweb/map3dModel";

const path = process.argv[2];
if (!path) throw new Error("Usage: npx vite-node scripts/verify-seasonal-matrices.ts /path/to/gen5.nds");
const source = new Uint8Array(await readFile(path));
const project = await loadProjectFromRomBytes(source, basename(path), { selectedNarcs: ["headers"] });
await loadMatrixEditorData(project, { seasons: true });
const original = getMapReplacementBytes(project).slice(), originalRules = replacementRules(original);
assert.deepEqual(materializeMapReplacementFile(parseMapReplacementFile(original)), original);
const world = getMatrixSnapshot(project, 0), cell = world.cells.find(c => c.mapId === 64)!;
assert(cell, "native seasonal map 64 exists");
const header = resolveMatrixCellGraphicsHeader({ width: world.width, height: world.height, hasZones: world.hasHeaders,
  chunkIds: world.cells.map(c => c.mapId), zoneIds: world.cells.map(c => c.headerId ?? 0xffffffff) }, { matrixId: 0, x: cell.x, y: cell.y }, Object.values(project.headers!.rows));
const initial = await loadMap3dZone(project, header.index, { season: "winter" });
assert(initial.chunks.some(c => c.chunkId === 194), "native winter scene uses map 194");
setSeasonalAssignment(project, 0, "map", 64, [64, 64, 64, 64]);
const edited = await loadMap3dZone(project, header.index, { season: "winter" });
assert.notEqual(edited, initial, "replacement revision invalidates scene cache");
assert(edited.chunks.some(c => c.chunkId === 64), "viewer consumes current seasonal rule");
const draft = await loadMap3dZone(project, 0, { season: "winter", cache: false, matrixCell: { matrixId: 0, x: 0, y: 0 }, previewMap: { mapId: 194, headerId: header.index } });
assert.equal(draft.chunks.length, 1); assert.equal(draft.chunks[0].chunkId, 194); assert(draft.chunks[0].primitives.some(p => p.indices.length));
assert.equal(draft.entities.length, 0); assert.equal(draft.npcModels.length, 0);
const plain = world.cells.find(c => c.mapId < 65535 && getSeasonalAssignment(project, 0, "map", c.mapId).matches.length === 0)!;
setSeasonalAssignment(project, 0, "map", plain.mapId, [plain.mapId, plain.mapId, plain.mapId, 194]);
const duplicate = duplicateMatrix(project, 1);
setSeasonalAssignment(project, duplicate, "matrix", undefined, [duplicate, duplicate, 1, duplicate]);
assert.equal(resolveSeasonalMatrix(project, duplicate, "autumn").id, 1);
const smallHeader = Object.values(project.headers!.rows).find(row => Number(row.matrix_id) === 1)!;
linkHeaderToMatrix(project, duplicate, smallHeader.index);
assert.equal((await loadMap3dZone(project, smallHeader.index, { season: "autumn" })).matrixId, 1);
const current = getMapReplacementBytes(project);
for (let i = 0; i < originalRules.length; i++) {
  const rule = originalRules[i];
  const after = current.slice(i * 16, (i + 1) * 16), before = original.slice(i * 16, (i + 1) * 16);
  if (rule.condition === 0 && rule.patchType === 0 && rule.matrixId === 0 && rule.values[0] === 64) {
    assert.deepEqual(after.slice(0, 10), before.slice(0, 10)); assert.deepEqual(after.slice(12), before.slice(12));
  } else assert.deepEqual(after, before, `unrelated entry ${i} preserved`);
}
assert.equal(current.length, original.length + 32, "new map and matrix rules append two native entries");
const reopened = openProjectSession(structuredClone(createProjectDocument(project, false)));
assert.deepEqual(getMapReplacementBytes(reopened), current);
assert.deepEqual(getSeasonalAssignment(reopened, duplicate, "matrix").values, [duplicate, duplicate, 1, duplicate]);
const exported = new NintendoDSRom(await exportModifiedRom(project), { fileData: "view" });
const store = project.narcs.map_replace!;
assert.deepEqual(new NARC(exported.files[store.fileId]).files[0], current);
const reloaded = await loadProjectFromRomBytes(exported.data, "seasonal-export.nds", { selectedNarcs: ["headers"] });
await loadMatrixEditorData(reloaded, { seasons: true });
assert.deepEqual(getMapReplacementBytes(reloaded), current);
assert.equal(resolveSeasonalMatrix(reloaded, duplicate, "autumn").id, 1);
console.log(JSON.stringify({ rom: basename(path), version: project.session.baseVersion, originalRules: originalRules.length,
  codecRoundTrip: true, unknownAndUnrelatedEntriesPreserved: true, appendedRules: 2, projectReopen: true,
  romExportReload: true, seasonalSceneAndCache: true, draftPreviewGeometry: true, repeatedCells: getSeasonalAssignment(project, 0, "map", plain.mapId).affected.length }));
