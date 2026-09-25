// Verifies the English IRDI alpha upgrades without dropping authored dialogue/gifts.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { loadProjectFromRomBytes } from "../src/pokeweb/loader";
import { exportModifiedRom } from "../src/pokeweb/exportRom";
import { followerRomSha256, followerRuntimeVersion, installFollowerAlpha, readFollowerAlphaInstall, readFollowerDialogueRules,
  readFollowerItemRules, writeFollowerDialogueRules, writeFollowerItemRules,
  FOLLOWER_INTERACTIONS_PATH, FOLLOWER_LANGUAGE_PATH } from "../src/pokeweb/followingPokemonProject";
import { NintendoDSRom } from "../src/nds/rom";
import manifest from "../src/assets/following/white2italy/interactions.json";

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error("Expected English IRDI alpha and upgrade output path");
globalThis.fetch = (async (request: RequestInfo | URL) => {
  const url = new URL(request instanceof Request ? request.url : String(request));
  if (url.protocol !== "file:") throw new Error(`Unexpected remote asset ${url}`);
  return new Response(new Uint8Array(await readFile(url)));
}) as typeof fetch;
const project = await loadProjectFromRomBytes(new Uint8Array(await readFile(input)), basename(input), { selectedNarcs: [] });
const previousVersion = (await readFollowerAlphaInstall(project))?.version;
assert.ok(["0.6.27-alpha", "0.6.28-alpha", "0.6.29-alpha", "0.6.30-alpha", "0.6.31-alpha", "0.6.32-alpha", "0.6.33-alpha", "0.6.34-alpha"].includes(previousVersion ?? ""));
const dialogue = [{zone: 427, species: 151, text: "{nickname} saluta {player}!"}];
const gifts = [{slot: 0, itemId: 1, quantity: 1, itemName: "Master Ball", text: "{nickname} found a {item}!", zone: 427, species: 151}];
await writeFollowerDialogueRules(project, dialogue);
await writeFollowerItemRules(project, gifts);
const updated = await installFollowerAlpha(project);
assert.equal(updated.version, await followerRuntimeVersion(project));
assert.deepEqual(await readFollowerDialogueRules(project), dialogue);
assert.deepEqual(await readFollowerItemRules(project), gifts);
const bytes = await exportModifiedRom(project);
await writeFile(output, bytes);
const reopened = await loadProjectFromRomBytes(bytes, basename(output), { selectedNarcs: [] });
assert.equal((await readFollowerAlphaInstall(reopened))?.version, updated.version);
assert.deepEqual(await readFollowerDialogueRules(reopened), dialogue);
assert.deepEqual(await readFollowerItemRules(reopened), gifts);
const rom = new NintendoDSRom(bytes, {fileData:"view"});
assert.equal(await followerRomSha256(rom.getFileByName(FOLLOWER_INTERACTIONS_PATH)), manifest.dataSha256);
const language = rom.getFileByName(FOLLOWER_LANGUAGE_PATH), view = new DataView(language.buffer, language.byteOffset, language.byteLength);
const text = Array.from({length:(language.length-18)/2}, (_,i) => String.fromCharCode(view.getUint16(16+i*2,true))).join("");
assert.equal(text,"La Borsa è piena!");
console.log(`Italian ${previousVersion} → ${updated.version} upgrade passed; authored dialogue/gifts retained and Italian generic reactions installed. No game emulator run.`);
