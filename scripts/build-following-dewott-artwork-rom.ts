import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { PNG } from "pngjs";
import { loadProjectFromRomBytes } from "../src/pokeweb/loader";
import { exportModifiedRom } from "../src/pokeweb/exportRom";
import { NintendoDSRom } from "../src/nds/rom";
import { NARC } from "../src/nds/narc";
import { readU16, readU32 } from "../src/nds/binary";
import { encodeFollowerFrames, followerFramesFromSheet, followerKey, decodeFollowerRegistry } from "../src/pokeweb/followingPokemonModel";
import { prepareFollowerWorkspace, followerRom, followerProfile, replaceFollowerAssets,
  installFollowerAlpha, followerArtworkPending, readFollowerAlphaInstall, FOLLOWER_RESOURCE_PATH,
  FOLLOWER_RUNTIME_REGISTRY_PATH, FOLLOWER_DESCRIPTOR_PATH, followerBillboardRepairPending } from "../src/pokeweb/followingPokemonProject";

const [input, output, saveSource] = process.argv.slice(2);
if (!input || !output?.endsWith(".nds")) throw new Error("Pass a clean stock BW2 ROM, a new versioned output .nds path, and an optional matching ordinary save.");
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  assert.equal(url.protocol, "file:");
  return new Response(new Uint8Array(await readFile(url)));
}) as typeof fetch;
const project = await loadProjectFromRomBytes(new Uint8Array(await readFile(input)), basename(input), { selectedNarcs: [] });
const rom = await followerRom(project), profile = await followerProfile(project, rom);
assert.ok(profile === "stock" || profile === "black2");
// Exercise the same post-install Apply follower artwork route as the editor.
await installFollowerAlpha(project, rom, { riding: true });
const workspace = await prepareFollowerWorkspace(project, rom);
const png = PNG.sync.read(await readFile(new URL("../src/test/fixtures/follower-dewott-replacement.png", import.meta.url)));
const frames = followerFramesFromSheet({ width: png.width, height: png.height, rgba: new Uint8Array(png.data) });
const template = new Uint8Array(await readFile(new URL("../src/assets/following/template-32-8.btx", import.meta.url)));
const bytes = encodeFollowerFrames(frames, template), entries = workspace.registry.entries.filter(entry => entry.key.species === 502);
assert.equal(entries.length, 4); // Male/female and normal/shiny in the stock personal data.
replaceFollowerAssets(project, rom, entries.map(entry => ({ key: entry.key, bytes, profile: "pokemon-asymmetric", source: "png", label: "Supplied Brionne sheet over Dewott" })));
assert.equal(followerArtworkPending(project, rom), true);
const state = await installFollowerAlpha(project, rom);
assert.equal(followerArtworkPending(project, rom), false);
const exported = await exportModifiedRom(project), exportedRom = new NintendoDSRom(exported, { fileData: "view" });
const reopened = await loadProjectFromRomBytes(exported, "dewott-replacement.nds", { selectedNarcs: [] });
assert.equal((await readFollowerAlphaInstall(reopened))?.moduleSha256, state.moduleSha256);
const resources = new NARC(exportedRom.getFileByName(FOLLOWER_RESOURCE_PATH)).files;
const registry = decodeFollowerRegistry(exportedRom.getFileByName(FOLLOWER_RUNTIME_REGISTRY_PATH));
const descriptors = new NARC(exportedRom.getFileByName(FOLLOWER_DESCRIPTOR_PATH)).files[0];
for (const entry of registry.entries.filter(entry => entry.key.species === 502)) {
  assert.deepEqual(resources[entry.resourceId], bytes, followerKey(entry.key));
  assert.equal(descriptors[4 + entry.descriptorRow * 28 + 7], 0, "Full native 32×32 frame window");
}
assert.equal(followerBillboardRepairPending(reopened, exportedRom), false);
assert.equal(registry.entries.filter(entry => entry.key.species >= 494 && entry.placeholder).length, 0);
let save: Uint8Array | undefined;
if (saveSource) {
  save = new Uint8Array(await readFile(saveSource)); assert.equal(save.length, 0x80000);
  const crc = (data: Uint8Array) => {
    let value = 0xffff;
    for (const byte of data) { value ^= byte << 8; for (let i = 0; i < 8; ++i) value = ((value << 1) ^ (value & 0x8000 ? 0x1021 : 0)) & 0xffff; }
    return value;
  };
  assert.ok([0, 0x26000].some(half => {
    const count = readU32(save!, half + 0x18e04), capacity = readU32(save!, half + 0x18e00);
    return count >= 1 && count <= capacity && capacity <= 6 &&
      crc(save!.subarray(half + 0x18e00, half + 0x19334)) === readU16(save!, half + 0x19336) &&
      crc(save!.subarray(half + 0x25f00, half + 0x25f94)) === readU16(save!, half + 0x25fa2);
  }), "Expected a valid BW2 ordinary save, not a BW1 save.");
}
await writeFile(output, exported, { flag: "wx" });
if (save) await writeFile(output.slice(0, -4) + ".sav", save, { flag: "wx" });
console.log(JSON.stringify({ rom: output, profile, version: state.version, variant: state.variant,
  replacedAppearanceKeys: entries.map(entry => followerKey(entry.key)), frameCount: frames.length,
  frameSize: 32, nativeFrameMode: 0, opaqueColors: 12, exportReopenVerified: true, emulatorRun: false, saveSource }, null, 2));
