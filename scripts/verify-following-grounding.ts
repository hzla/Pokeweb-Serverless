// Verify install-time sprite grounding without launching a game emulator.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { NARC } from "../src/nds/narc";
import { NintendoDSRom } from "../src/nds/rom";
import { buildGen5FollowerArchives } from "../src/pokeweb/followingPokemonProject";
import { decodeFollowerRegistry, followerGroundingPixels, followerHasFlyingType, followerKey, FOLLOWER_EXTRA_GROUNDING_PIXELS } from "../src/pokeweb/followingPokemonModel";

const sourcePath = process.argv[2];
if (!sourcePath) throw new Error("Expected a clean audited Black 2/White 2 ROM path.");
const source = new NintendoDSRom(new Uint8Array(await readFile(sourcePath)), { fileData: "view" });
const installed = source.filenames.idOf("following/runtime-registry.bin") !== undefined;
const bundled = new Uint8Array(await readFile(new URL("../src/assets/following/gen5-followers.narc", import.meta.url)));
const later = process.argv[3] === "upgrade" ? new Uint8Array(await readFile(new URL("../src/assets/following/white2upgrade/later-followers.narc", import.meta.url))) : undefined;
const archive = installed ? {
  registry: decodeFollowerRegistry(source.getFileByName("following/runtime-registry.bin")),
  descriptors: source.getFileByName("a/0/4/7"), resources: source.getFileByName("a/0/4/8"),
} : buildGen5FollowerArchives(source.getFileByName("a/0/1/6"), source.getFileByName("a/2/0/8"),
  source.getFileByName("a/0/4/7"), source.getFileByName("a/0/4/8"), bundled, undefined, later);
const personal = new NARC(source.getFileByName("a/0/1/6")).files;
const descriptors = new NARC(archive.descriptors).files[0], original = installed ? undefined : new NARC(source.getFileByName("a/0/4/7")).files[0];
const resources = new NARC(archive.resources).files;
if (original) assert.deepEqual(descriptors.subarray(4, original.length), original.subarray(4));
let grounded = 0, flying = 0, lowered = 0;
const marginCache = new Map<number, number>();
for (const entry of archive.registry.entries) {
  const at = 4 + entry.descriptorRow * 28;
  assert.equal(descriptors[at + 4], 1); // Native shadow remains enabled.
  assert.equal((descriptors[at + 14] << 24) >> 24, 0); // Native shadow stays on the actor ground plane.
  const flight = followerHasFlyingType(personal, entry.key);
  if (flight) { ++flying; assert.equal(entry.offsets[1], 0); continue; }
  ++grounded;
  if (!marginCache.has(entry.resourceId)) marginCache.set(entry.resourceId, followerGroundingPixels(resources[entry.resourceId], entry.animationProfile));
  assert.equal(entry.offsets[1], 0 - marginCache.get(entry.resourceId)! - FOLLOWER_EXTRA_GROUNDING_PIXELS);
  if (entry.offsets[1] < 0) ++lowered;
}
let comparison = "";
if (installed && process.argv[3]?.endsWith(".nds")) {
  const previous = new NintendoDSRom(new Uint8Array(await readFile(process.argv[3])), { fileData: "view" });
  const old = decodeFollowerRegistry(previous.getFileByName("following/runtime-registry.bin"));
  const oldByKey = new Map(old.entries.map(entry => [followerKey(entry.key), entry]));
  const oldDescriptors = new NARC(previous.getFileByName("a/0/4/7")).files[0];
  assert.deepEqual(source.getFileByName("a/0/4/8"), previous.getFileByName("a/0/4/8"));
  for (const entry of archive.registry.entries) {
    const prior = oldByKey.get(followerKey(entry.key));
    assert.ok(prior, `Missing prior appearance ${followerKey(entry.key)}`);
    assert.equal(entry.offsets[1], prior.offsets[1]);
    assert.equal((oldDescriptors[4 + prior.descriptorRow * 28 + 14] << 24) >> 24, prior.offsets[1]);
  }
  comparison = " Sprite-only offsets and resource artwork are byte-identical to the prior alpha; native descriptor Y is restored to zero for shadow placement.";
}
console.log(`${source.idCode}: ${archive.registry.entries.length} ${installed ? "installed" : "built"} appearances checked; ${grounded} grounded, ${flying} Flying, ${lowered} lowered. Native shadow flags retained with descriptor Y at ground; ${installed ? "retail rows checked separately by installer verification" : "stock descriptors preserved"}.${comparison} No emulator run.`);
