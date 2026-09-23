// Static Italian installation/export round trip. Never starts an emulator or copies a save.
import assert from "node:assert/strict";
import { basename } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { NintendoDSRom } from "../src/nds/rom";
import { NARC } from "../src/nds/narc";
import { loadProjectFromRomBytes } from "../src/pokeweb/loader";
import { exportModifiedRom } from "../src/pokeweb/exportRom";
import { parseRpm } from "../src/pokeweb/rpm";
import { checkFollowerCompatibility, followerProfile, followerRomSha256, installFollowerAlpha,
  followerRuntimeVersion, readFollowerAlphaInstall, removeFollowerAlpha, setFollowerAlphaEnabled, FOLLOWER_LANGUAGE_PATH } from "../src/pokeweb/followingPokemonProject";

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error("Expected clean IRDI ROM and output path");
globalThis.fetch = (async (request: RequestInfo | URL) => {
  const url = new URL(request instanceof Request ? request.url : String(request));
  if (url.protocol !== "file:") throw new Error(`Unexpected remote asset ${url}`);
  return new Response(new Uint8Array(await readFile(url)));
}) as typeof fetch;
const source = new Uint8Array(await readFile(input));
const project = await loadProjectFromRomBytes(source, basename(input), { selectedNarcs: [] });
assert.equal(await followerProfile(project), "white2italy");
const compatibility = await checkFollowerCompatibility(project);
assert.equal(compatibility.compatible, true, compatibility.message);
// Match the browser after project persistence: ROM bytes live in storage and
// originalRomBytes is absent when the user presses Install.
const storedRequest = <T>(result: T): IDBRequest<T> => {
  const request = { result } as IDBRequest<T>;
  queueMicrotask(() => request.onsuccess?.(new Event("success")));
  return request;
};
const db = { transaction: () => ({ objectStore: () => ({ get: () => storedRequest(source) }) }), close: () => {} };
globalThis.indexedDB = { open: () => storedRequest(db) } as unknown as IDBFactory;
delete project.originalRomBytes;
assert.equal(project.originalRomBytes, undefined);
const state = await installFollowerAlpha(project);
assert.equal(state.profile, "white2italy");
assert.equal(state.version, await followerRuntimeVersion(project));
assert.equal((await installFollowerAlpha(project)).moduleSha256, state.moduleSha256);
project.narcs = {};
const bytes = await exportModifiedRom(project);
const exported = new NintendoDSRom(bytes, { fileData: "view" });
assert.equal(exported.idCode, "IRDI");
const original = new NintendoDSRom(source, {fileData: "view"});
const loader = parseRpm(exported.getFileByName("codeinjection/RPMSYM-PMC.rpm"));
assert.equal(loader.metadata.PMCGameID, "W2I");
const retailRows = new NARC(original.getFileByName("a/0/4/7")).files[0];
const appendedRows = new NARC(exported.getFileByName("a/0/4/7")).files[0];
assert.deepEqual(appendedRows.subarray(4, retailRows.length), retailRows.subarray(4));
assert.deepEqual(exported.getFileByName("a/0/1/6"), original.getFileByName("a/0/1/6"));
assert.deepEqual(exported.getFileByName("a/2/0/8"), original.getFileByName("a/2/0/8"));
assert.deepEqual(exported.getFileByName("a/0/0/2"), original.getFileByName("a/0/0/2"));
assert.deepEqual(exported.getFileByName("a/0/0/3"), original.getFileByName("a/0/0/3"));
assert.deepEqual(exported.getFileByName("a/0/5/6"), original.getFileByName("a/0/5/6"));
const language = exported.getFileByName(FOLLOWER_LANGUAGE_PATH);
assert.equal(await followerRomSha256(language), state.languageSha256);
await writeFile(output, bytes);
const reopened = await loadProjectFromRomBytes(bytes, basename(output), { selectedNarcs: [] });
assert.deepEqual(await readFollowerAlphaInstall(reopened), state);
await setFollowerAlphaEnabled(reopened, false);
assert.equal((await readFollowerAlphaInstall(reopened))?.enabled, false);
await setFollowerAlphaEnabled(reopened, true);
assert.equal((await readFollowerAlphaInstall(reopened))?.enabled, true);
await removeFollowerAlpha(reopened);
assert.equal((await readFollowerAlphaInstall(reopened))?.removed, true);
console.log(`Italian install/reinstall/export/reopen/disable/enable/remove passed. ROM SHA-256 ${await followerRomSha256(bytes)}. No game emulator run.`);
