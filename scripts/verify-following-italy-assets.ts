// Verify the Italian profile can replace artwork through the editor data path.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { loadProjectFromRomBytes } from "../src/pokeweb/loader";
import { exportModifiedRom } from "../src/pokeweb/exportRom";
import { followerRom, installFollowerAlpha, prepareFollowerWorkspace, readFollowerAsset,
  readFollowerWorkspace, replaceFollowerAssets } from "../src/pokeweb/followingPokemonProject";
import { followerKey } from "../src/pokeweb/followingPokemonModel";

const input = process.argv[2];
if (!input) throw new Error("Expected clean IRDI ROM");
globalThis.fetch = (async (request: RequestInfo | URL) => {
  const url = new URL(request instanceof Request ? request.url : String(request));
  if (url.protocol !== "file:") throw new Error(`Unexpected remote asset ${url}`);
  return new Response(new Uint8Array(await readFile(url)));
}) as typeof fetch;
const project = await loadProjectFromRomBytes(new Uint8Array(await readFile(input)), basename(input), { selectedNarcs: [] });
const rom = await followerRom(project);
const workspace = await prepareFollowerWorkspace(project, rom);
const entry = workspace.registry.entries.find(value => value.key.species === 1 && value.key.form === 0 && value.key.gender === 0 && !value.key.shiny);
if (!entry) throw new Error("Missing Bulbasaur appearance in Italian catalog");
const resource = new Uint8Array(await readFile(new URL("../src/assets/following/template-32-8.btx", import.meta.url)));
replaceFollowerAssets(project, rom, [{ key: entry.key, bytes: resource, profile: "pokemon-asymmetric", source: "png", label: "Italian replacement test" }]);
await installFollowerAlpha(project);
const output = await exportModifiedRom(project);
const reopened = await loadProjectFromRomBytes(output, "italian-asset-check.nds", { selectedNarcs: [] });
const reopenedRom = await followerRom(reopened);
const restored = readFollowerWorkspace(reopened, reopenedRom);
if (!restored) throw new Error("Italian asset workspace was not retained");
const changed = restored.registry.entries.find(value => followerKey(value.key) === followerKey(entry.key));
if (!changed) throw new Error("Replaced appearance missing after export");
assert.deepEqual(readFollowerAsset(reopened, reopenedRom, restored, changed), resource);
console.log("Italian asset replacement/export/reopen passed without rebuilding W2I DLLs. No game emulator run.");
