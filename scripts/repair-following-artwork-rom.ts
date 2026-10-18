/** Repair installed native drawing/animation selectors without replacing assets or code. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { createHash } from "node:crypto";
import { NintendoDSRom } from "../src/nds/rom";
import { NARC } from "../src/nds/narc";
import { loadProjectFromRomBytes } from "../src/pokeweb/loader";
import { exportModifiedRom } from "../src/pokeweb/exportRom";
import { followerRom, installFollowerAlpha, readFollowerAlphaInstall, followerBillboardRepairPending,
  FOLLOWER_DESCRIPTOR_PATH, FOLLOWER_INSTALL_PATH, FOLLOWER_MANIFEST_PATH } from "../src/pokeweb/followingPokemonProject";

const [input, output, saveSource] = process.argv.slice(2);
if (!input || !output?.endsWith(".nds")) throw new Error("Pass an installed BW2 ROM, a new output .nds path, and an optional ordinary save to copy.");
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  assert.equal(url.protocol, "file:");
  return new Response(new Uint8Array(await readFile(url)));
}) as typeof fetch;
const bytes = new Uint8Array(await readFile(input));
const source = new NintendoDSRom(bytes, {fileData: "view"});
const project = await loadProjectFromRomBytes(bytes, basename(input), {selectedNarcs: []});
const active = await followerRom(project), before = await readFollowerAlphaInstall(project, active);
assert.ok(before && !before.removed && !before.externalRuntime);
assert.equal(followerBillboardRepairPending(project, active), true, "No drawing or animation repair is pending.");
const installed = await installFollowerAlpha(project, active);
assert.equal(installed.enabled, before.enabled, "A data repair must retain the runtime enable setting.");
assert.equal(followerBillboardRepairPending(project, active), false);
const exported = await exportModifiedRom(project), result = new NintendoDSRom(exported, {fileData: "view"});
const reopened = await loadProjectFromRomBytes(exported, basename(output), {selectedNarcs: []});
assert.equal((await readFollowerAlphaInstall(reopened))?.version, before.version);
assert.equal(followerBillboardRepairPending(reopened, result), false);
assert.equal(result.files.length, source.files.length);
const allowed = new Set([FOLLOWER_DESCRIPTOR_PATH, FOLLOWER_INSTALL_PATH, FOLLOWER_MANIFEST_PATH]);
const allowedIds = new Map([...allowed].map(path => [result.filenames.idOf(path), path]));
const changed: string[] = [];
const sha = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
assert.deepEqual(result.filenames, source.filenames);
for (let id = 0; id < result.files.length; ++id) {
  if (sha(result.files[id]) === sha(source.files[id])) continue;
  const path = allowedIds.get(id);
  assert.ok(path && allowed.has(path), `Unexpected changed file ${id}`); changed.push(path);
}
for (const key of ["arm9", "arm7", "arm9OverlayTable", "arm7OverlayTable"] as const) assert.deepEqual(result[key], source[key]);
const oldDesc = new NARC(source.getFileByName(FOLLOWER_DESCRIPTOR_PATH)).files[0];
const newDesc = new NARC(result.getFileByName(FOLLOWER_DESCRIPTOR_PATH)).files[0];
assert.equal(newDesc.length, oldDesc.length);
const repairs: Array<{row: number; byte: number; before: number; after: number}> = [];
for (let at = 0; at < oldDesc.length; ++at) if (oldDesc[at] !== newDesc[at]) {
  const row = Math.floor((at - 4) / 28), byte = (at - 4) % 28;
  assert.ok(row >= 1008 && (byte === 7 || byte === 9));
  repairs.push({row, byte, before: oldDesc[at], after: newDesc[at]});
}
const repeat = reopened.fileSystem;
await installFollowerAlpha(reopened, await followerRom(reopened)); assert.equal(reopened.fileSystem, repeat);
const save = saveSource ? new Uint8Array(await readFile(saveSource)) : undefined;
if (save) assert.equal(save.length, 0x80000);
await writeFile(output, exported, {flag: "wx"});
if (save) await writeFile(output.slice(0, -4) + ".sav", save, {flag: "wx"});
const report = {source: input, sourceSha256: sha(bytes), rom: output, sha256: sha(exported),
  profile: before.profile, variant: before.variant, version: before.version, repairedRows: new Set(repairs.map(row => row.row)).size,
  repairs, changedFiles: changed, fileIdsPreserved: true, artworkAndModulesUnchanged: true,
  nativeProgramsUnchanged: true, exportReopenAndIdempotence: true, saveSource, saveSha256: save && sha(save), gameEmulatorRun: false};
await writeFile(output.slice(0, -4) + ".json", JSON.stringify(report, null, 2) + "\n", {flag: "wx"});
console.log(JSON.stringify({...report, repairs: undefined}, null, 2));
