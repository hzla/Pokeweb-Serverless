// Verify the preceding Surf alpha upgrades with authored data intact.
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { loadProjectFromRomBytes } from "../src/pokeweb/loader";
import { exportModifiedRom } from "../src/pokeweb/exportRom";
import { NintendoDSRom } from "../src/nds/rom";
import { installFollowerAlpha, readFollowerAlphaInstall,
  FOLLOWER_DIALOGUE_NARC_PATH, FOLLOWER_ITEM_NARC_PATH, FOLLOWER_SURF_REGISTRY_PATH,
  FOLLOWER_SURF_RESOURCE_PATH } from "../src/pokeweb/followingPokemonProject";
import upgradeSurf from "../src/assets/following/white2upgrade/surf-mounts.json";
import stockSurf from "../src/assets/following/surf-mounts.json";

const path = process.argv[2];
if (!path) throw new Error("Expected a prior stock or White2Upgrade Surf alpha ROM");
globalThis.fetch = (async(input: RequestInfo | URL) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.protocol !== "file:") throw new Error(`Expected local asset ${url}`);
  return new Response(new Uint8Array(await readFile(url)));
}) as typeof fetch;
const bytes = new Uint8Array(await readFile(path));
const original = new NintendoDSRom(bytes, { fileData: "view" });
const owned = (rom: NintendoDSRom, name: string) => rom.files[rom.filenames.idOf(name)!];
const project = await loadProjectFromRomBytes(bytes, basename(path), { selectedNarcs: [] });
const prior = await readFollowerAlphaInstall(project);
const profile = prior?.profile;
if (!prior || !((profile === "stock" && prior.version === "0.6.41-alpha") ||
                (profile === "white2upgrade" && prior.version === "0.7.25-alpha")))
  throw new Error("Expected the pinned prior Surf alpha");
const expectedVersion = profile === "stock" ? "0.6.42-alpha" : "0.7.26-alpha";
const surf = profile === "stock" ? stockSurf : upgradeSurf;
const installed = await installFollowerAlpha(project);
if (installed.version !== expectedVersion || !installed.enabled ||
    installed.surfSha256 !== surf.sha256 || installed.surfRegistrySha256 !== surf.registrySha256)
  throw new Error("Upgrade receipt, enabled state, or Surf ownership mismatch");
project.narcs = {};
const upgradedBytes = await exportModifiedRom(project);
const upgraded = new NintendoDSRom(upgradedBytes, { fileData: "view" });
for (const name of [FOLLOWER_DIALOGUE_NARC_PATH, FOLLOWER_ITEM_NARC_PATH]) {
  const a = owned(original, name), b = owned(upgraded, name);
  if (a.length !== b.length || a.some((value, index) => value !== b[index])) throw new Error(`Upgrade changed authored ${name}`);
}
if (owned(upgraded, FOLLOWER_SURF_RESOURCE_PATH).length !== surf.bytes ||
    owned(upgraded, FOLLOWER_SURF_REGISTRY_PATH).length !== surf.registryBytes)
  throw new Error("Upgraded Surf archive or registry length mismatch");
const reopened = await loadProjectFromRomBytes(upgradedBytes, "upgraded.nds", { selectedNarcs: [] });
const receipt = await readFollowerAlphaInstall(reopened);
if (receipt?.version !== expectedVersion || !receipt.enabled) throw new Error("Upgraded export did not reopen");
console.log(`Prior ${profile} Surf alpha upgrade, authored data retention, Surf ownership, export and reopen passed; no emulator run.`);
