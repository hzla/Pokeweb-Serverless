// Local, in-memory verification. Source ROMs and user saves are never written.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { readU16, writeU16 } from "../src/nds/binary";
import { NARC } from "../src/nds/narc";
import { NintendoDSRom } from "../src/nds/rom";
import { loadProjectFromRomBytes } from "../src/pokeweb/loader";
import { applyGen5MapImport, prepareGen5MapImport, undoGen5MapImport } from "../src/pokeweb/gen5MapImport";
import { readGen5MapBin } from "../src/pokeweb/gen5MapImportFormats";
import { loadMap3dZone } from "../src/pokeweb/map3dModel";
import { resolveSeasonalMatrix } from "../src/pokeweb/seasonalMatrixModel";
import { exportModifiedRom } from "../src/pokeweb/exportRom";
import { createProjectDocument } from "../src/pokeweb/projectDocument";
import { openProjectSession } from "../src/pokeweb/projectSession";
import { loadMatrixEditorData } from "../src/pokeweb/matrixModel";

const path = process.argv[2];
if (!path) throw new Error("Usage: npx vite-node scripts/verify-gen5-map-import.ts <local ROM> [header ID]");
const source = new Uint8Array(await readFile(path));
const project = await loadProjectFromRomBytes(source, basename(path), { selectedNarcs: ["headers"] });
const game = project.session.baseRom; assert(game === "BW" || game === "BW2");
const zoneId = Number(process.argv[3] ?? (game === "BW2" ? 427 : 0));
await loadMatrixEditorData(project, { seasons: true });
const data = await loadMap3dZone(project, zoneId, { season: "winter" }), chunk = data.chunks[0];
assert(chunk, "selected header has terrain");
const target = { matrixId: data.sourceMatrixId, x: chunk.matrixX, y: chunk.matrixY, headerId: zoneId, season: "winter" as const };
const original = project.narcs.maps!.rawFiles[chunk.chunkId], members = readGen5MapBin(original);
const noedit = await prepareGen5MapImport(project, { game, bin: original }, target); assert.equal(noedit.changes.length, 0, "native BIN no-op");
const permissions = members.files[1].slice(); writeU16(permissions, 10, readU16(permissions, 10) ^ 1);
const fixtureFlag = process.argv.indexOf("--fixture-out");
if (fixtureFlag >= 0) {
  const directory = process.argv[fixtureFlag + 1]; assert(directory, "--fixture-out requires a directory");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "collision.per"), permissions);
}
const baselineSeasons = (["spring", "summer", "autumn"] as const).map(s => {
  const snapshot = resolveSeasonalMatrix(project, target.matrixId, s), c = snapshot.cells.find(c => c.x === target.x && c.y === target.y)!;
  return project.narcs.maps!.rawFiles[c.mapId].slice();
});
const result = await prepareGen5MapImport(project, { game, permissions }, target);
assert.deepEqual(project.narcs.maps!.rawFiles[chunk.chunkId], original, "preview keeps native source");
await applyGen5MapImport(project, result);
const current = readGen5MapBin(project.narcs.maps!.rawFiles[result.mapId]); assert.deepEqual(current.files[1], permissions);
for (const [i, part] of current.files.entries()) if (i !== 1) assert.deepEqual(part, members.files[i], `member ${i} preserved`);
for (const [i, season] of (["spring", "summer", "autumn"] as const).entries()) {
  const snapshot = resolveSeasonalMatrix(project, target.matrixId, season), c = snapshot.cells.find(c => c.x === target.x && c.y === target.y)!;
  assert.deepEqual(project.narcs.maps!.rawFiles[c.mapId], baselineSeasons[i], `${season} preserved`);
}
const reopened = openProjectSession(structuredClone(createProjectDocument(project, false)));
assert.deepEqual(reopened.narcs.maps!.rawFiles[result.mapId], project.narcs.maps!.rawFiles[result.mapId]);
const exported = await exportModifiedRom(project), rom = new NintendoDSRom(exported, { fileData: "view" });
assert.deepEqual(new NARC(rom.getFileByName("a/0/0/8")).files[result.mapId], project.narcs.maps!.rawFiles[result.mapId]);
const reloaded = await loadProjectFromRomBytes(exported, "map-import-verification.nds", { selectedNarcs: ["headers"] });
await loadMatrixEditorData(reloaded, { seasons: true });
const scene = await loadMap3dZone(reloaded, zoneId, { season: "winter" }); assert(scene.chunks.some(c => c.chunkId === result.mapId));
const emulatorFlag = process.argv.indexOf("--emulator-out");
if (emulatorFlag >= 0) {
  assert(process.argv[emulatorFlag + 1], "--emulator-out requires an output directory");
  const { verifyMapImportEmulator } = await import("./verify-gen5-map-import-emulator");
  await verifyMapImportEmulator(project, permissions, process.argv[emulatorFlag + 1]);
}
await undoGen5MapImport(project, result); assert.deepEqual(project.narcs.maps!.rawFiles[chunk.chunkId], original);
console.log(JSON.stringify({ family: game, header: zoneId, noEditIdentical: true, collisionAndHeightPayload: true, otherMembersPreserved: true,
  unselectedSeasonsPreserved: true, projectReopen: true, romExportReload: true, undo: true, emulatorTested: emulatorFlag >= 0 }));
