/** Save captured, corrected dialogue through the same API as the editor. No emulator. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { createHash } from "node:crypto";
import { loadProjectFromRomBytes } from "../src/pokeweb/loader";
import { exportModifiedRom } from "../src/pokeweb/exportRom";
import { NintendoDSRom } from "../src/nds/rom";
import { getOverworldScene } from "../src/pokeweb/overworldModel";
import { decodeFollowerDialogueNarc } from "../src/pokeweb/followingPokemonDialogues";
import { followerRom, readFollowerAlphaInstall, readFollowerDialogueRules, writeFollowerDialogueRules,
  FOLLOWER_DIALOGUE_NARC_PATH, FOLLOWER_INSTALL_PATH } from "../src/pokeweb/followingPokemonProject";

const [input, dialogueNarc, output] = process.argv.slice(2);
if (!input || !dialogueNarc || !output?.endsWith(".nds")) throw new Error("Pass input ROM, corrected dialogue NARC, and a new output .nds path.");
const bytes = new Uint8Array(await readFile(input)), original = new NintendoDSRom(bytes, {fileData: "view"});
const project = await loadProjectFromRomBytes(bytes, basename(input), {selectedNarcs: ["overworlds", "matrix", "maps"]});
const rom = await followerRom(project), before = await readFollowerAlphaInstall(project, rom);
assert.ok(before?.tileBounds);
const scene = getOverworldScene(project, 163, 428);
assert.deepEqual([scene.translateX, scene.translateY], [32, 704]);
const rules = decodeFollowerDialogueNarc(new Uint8Array(await readFile(dialogueNarc)));
assert.deepEqual(rules.map(({zone, minX, maxX, minY, maxY}) => ({zone, minX, maxX, minY, maxY})), [{zone: 427, minX: 34, maxX: 38, minY: 709, maxY: 709}]);
await writeFollowerDialogueRules(project, rules, rom);
assert.deepEqual(await readFollowerDialogueRules(project, rom), rules);
// Read-only map decoding must not materialize unrelated editor data.
project.narcs = {};
const exported = await exportModifiedRom(project), result = new NintendoDSRom(exported, {fileData: "view"});
const reopened = await loadProjectFromRomBytes(exported, basename(output), {selectedNarcs: ["overworlds"]});
assert.deepEqual(await readFollowerDialogueRules(reopened), rules);
assert.equal((await readFollowerAlphaInstall(reopened))?.moduleSha256, before.moduleSha256);
assert.deepEqual(result.filenames, original.filenames); assert.equal(result.files.length, original.files.length);
const allowed = new Set([result.filenames.idOf(FOLLOWER_DIALOGUE_NARC_PATH), result.filenames.idOf(FOLLOWER_INSTALL_PATH)]);
const sha = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
const changedIds: number[] = [];
for (let i = 0; i < result.files.length; ++i) if (sha(result.files[i]) !== sha(original.files[i])) {
  assert.ok(allowed.has(i), `Unexpected changed file ${i}`); changedIds.push(i);
}
for (const key of ["arm9", "arm7", "arm9OverlayTable", "arm7OverlayTable"] as const) assert.deepEqual(result[key], original[key]);
await writeFile(output, exported, {flag: "wx"});
const report = {rom: output, sha256: sha(exported), sourceSha256: sha(bytes), zone: 427, overworldId: 163,
  origin: [scene.translateX, scene.translateY], rules, changedFileIds: changedIds,
  unrelatedFilesAndModulesUnchanged: true, exportReopenVerified: true, originalSaveFilesUnchanged: true, gameEmulatorRun: false};
await writeFile(output.slice(0, -4) + ".json", JSON.stringify(report, null, 2) + "\n", {flag: "wx"});
console.log(JSON.stringify(report, null, 2));
