// Upgrade an already installed stock ROM, including a prior same-version alpha.
// File-level check only; does not start a game emulator.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { loadProjectFromRomBytes } from "../src/pokeweb/loader";
import { exportModifiedRom } from "../src/pokeweb/exportRom";
import { installFollowerAlpha, readFollowerAlphaInstall, followerRomSha256,
  FOLLOWER_DIALOGUE_NARC_PATH, FOLLOWER_ITEM_NARC_PATH } from "../src/pokeweb/followingPokemonProject";
import manifest from "../src/assets/following/runtime.json";
import { NintendoDSRom } from "../src/nds/rom";

const path = process.argv[2];
if (!path) throw new Error("Expected a previously installed stock White 2 ROM");
globalThis.fetch = (async (input: RequestInfo | URL) =>
  new Response(new Uint8Array(await readFile(new URL(input instanceof Request ? input.url : String(input)))))) as typeof fetch;
const project = await loadProjectFromRomBytes(new Uint8Array(await readFile(path)), basename(path), { selectedNarcs: [] });
const previous = await readFollowerAlphaInstall(project);
assert(previous?.enabled);
assert.notEqual(previous.moduleSha256, manifest.fieldSha256);
const source = new NintendoDSRom(project.originalRomBytes!, { fileData: "view" });
const authored = [FOLLOWER_DIALOGUE_NARC_PATH, FOLLOWER_ITEM_NARC_PATH].map(name => source.files[source.filenames.idOf(name)!].slice());
const updated = await installFollowerAlpha(project);
assert.equal(updated.version, manifest.version);
assert.equal(updated.moduleSha256, manifest.fieldSha256);
const exported = await exportModifiedRom(project);
const reopened = await loadProjectFromRomBytes(exported, "transition-upgraded.nds", { selectedNarcs: [] });
const receipt = await readFollowerAlphaInstall(reopened);
assert.equal(receipt?.moduleSha256, manifest.fieldSha256);
const result = new NintendoDSRom(exported, { fileData: "view" });
for (const [index, name] of [FOLLOWER_DIALOGUE_NARC_PATH, FOLLOWER_ITEM_NARC_PATH].entries())
  assert.deepEqual(result.files[result.filenames.idOf(name)!], authored[index]);
assert.equal(await followerRomSha256(result.files[result.filenames.idOf("patches/PokewebFollowingFieldW2.dll")!]), manifest.fieldSha256);
await installFollowerAlpha(reopened);
assert.equal((await readFollowerAlphaInstall(reopened))?.moduleSha256, manifest.fieldSha256);
console.log(`${previous.version} (${previous.moduleSha256.slice(0, 8)}) upgraded to ${manifest.version}; dialogue/gifts retained and reopen/reinstall passed. No game emulator run.`);
