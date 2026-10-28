import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { loadProjectFromRomBytes } from "../src/pokeweb/loader";
import { decodeBattleCameraOverlay, loadBattleCamera, updateBattleCamera } from "../src/pokeweb/battleCameraModel";
import { buildBattleEnvironmentTestDownloads } from "../src/pokeweb/battleEnvironmentTest";
import { loadBattleBackgroundCatalog, loadBattleEnvironmentArchives } from "../src/pokeweb/battleBackgroundModel";
import { loadBattlePlatformCatalog } from "../src/pokeweb/battlePlatformModel";
import { exportModifiedRom } from "../src/pokeweb/exportRom";
import { rawSaveBytesFromDesmumeDsv } from "../src/pokeweb/testBattle";
import { NintendoDSRom } from "../src/nds/rom";
import { NARC } from "../src/nds/narc";

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error("Usage: vite-node scripts/verify-battle-environment.ts SOURCE.nds NEW_OUTPUT_DIRECTORY");
globalThis.fetch = (async request => {
  const url = request instanceof URL ? request : new URL(request instanceof Request ? request.url : String(request));
  if (url.protocol !== "file:") throw new Error("Only bundled local assets are expected.");
  return new Response(new Uint8Array(await fs.readFile(url)));
}) as typeof fetch;
const hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
await fs.mkdir(output, { recursive: false });
const project = await loadProjectFromRomBytes(new Uint8Array(await fs.readFile(input)), "battle-environment.nds", { selectedNarcs: ["trdata", "trpok", "personal", "moves"] });
const camera = await loadBattleCamera(project);
assert.equal(camera.presets.length, 16);
const nativePose = structuredClone(camera.presets[0]);
const pose = { position: { x: 9.5, y: 7.25, z: 20 }, target: { x: 1.25, y: 2.75, z: -0.5 } };
updateBattleCamera(project, camera, "default", pose);
// Persist a different focused preset too, then verify the default survives.
updateBattleCamera(project, camera, "single-player", { position: { x: 5, y: 6, z: 18 }, target: { x: -1, y: 2, z: 3 } });
const exported = await exportModifiedRom(project, { preserveOriginalLength: true });
const exportedRom = new NintendoDSRom(exported, { fileData: "view" });
const exportedOverlay = exportedRom.loadArm9Overlays([168]).get(168)!;
assert.deepEqual((await decodeBattleCameraOverlay(exportedOverlay.data, exportedOverlay.ramAddress)).presets[0], { ...nativePose, ...pose });
const reloaded = await loadProjectFromRomBytes(exported, "reopened.nds", { selectedNarcs: ["trdata", "trpok", "personal", "moves"] });
assert.deepEqual((await loadBattleCamera(reloaded)).presets[0], { ...nativePose, ...pose });
console.log("Camera export/reopen passed.");
const backgroundCatalog = await loadBattleBackgroundCatalog(project), platforms = await loadBattlePlatformCatalog(project);
const background = backgroundCatalog.variants.find(v => v.tableIndex === 7 && v.seasonIndex === 1) ?? backgroundCatalog.variants.find(v => v.tableIndex === 7)!;
const platform = platforms.variants.find(v => v.tableIndex === 6)!;
assert(background && platform);
const before = structuredClone({ overlays: project.overlays, replacements: project.fileSystem?.replacements, patches: project.patches });
const selection = { trainerId: 2, backgroundIndex: background.tableIndex, backgroundSeasonIndex: background.seasonIndex, platformIndex: platform.tableIndex, platformSeasonIndex: platform.seasonIndex,
  camera: { presetId: "default", pose: { position: { x: 10, y: 8, z: 21 }, target: { x: 2, y: 3, z: -1 } } } };
const result = await buildBattleEnvironmentTestDownloads(project, selection);
assert.deepEqual({ overlays: project.overlays, replacements: project.fileSystem?.replacements, patches: project.patches }, before);
const rom = new NintendoDSRom(result.romBytes, { fileData: "view" }), overlay = rom.loadArm9Overlays([168]).get(168)!;
assert.deepEqual((await decodeBattleCameraOverlay(overlay.data, overlay.ramAddress)).presets[0], { ...nativePose, ...selection.camera.pose });
const archives = await loadBattleEnvironmentArchives(project);
const table = new NARC(rom.getFileByName(archives.table.path));
for (let i = 0; i < table.files[0].length; i += 44) {
  assert(table.files[0].subarray(i + 2, i + 22).every(id => id === background.tableIndex));
  assert(table.files[0].subarray(i + 22, i + 42).every(id => id === platform.tableIndex));
}
const save = rawSaveBytesFromDesmumeDsv(result.saveBytes);
await fs.writeFile(`${output}/test.nds`, result.romBytes, { flag: "wx" });
await fs.writeFile(`${output}/test.sav`, save, { flag: "wx" });
await fs.writeFile(`${output}/overlay168.bin`, overlay.data, { flag: "wx" });
const manifest = { passed: true, cameraExportReopen: true, projectUnchanged: true, selection, backgroundResource: background.resourceId, platformResource: platform.resourceId,
  config: { trainerId: 2 }, rule: 0, nativeVerification: { openingPresentation: "direct-placement" }, romSha256: hash(result.romBytes), saveSha256: hash(save) };
await fs.writeFile(`${output}/test.json`, JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify(manifest));
