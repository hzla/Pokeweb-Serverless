// Audit and exercise the real installer/exporter. No emulator or save is used.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { NintendoDSRom } from "../../src/nds/rom";
import { loadProjectFromRomBytes } from "../../src/pokeweb/loader";
import { exportModifiedRom } from "../../src/pokeweb/exportRom";
import { parseRpm, writeRpm } from "../../src/pokeweb/rpm";
import {
  checkFollowerCompatibility, followerRom, installFollowerAlpha, readFollowerAlphaInstall,
  readFollowingFile, readFollowerWorkspace, removeFollowerAlpha, setFollowerAlphaEnabled,
  FOLLOWER_INSTALL_PATH, FOLLOWER_MANIFEST_PATH, FOLLOWER_DESCRIPTOR_PATH,
} from "../../src/pokeweb/followingPokemonProject";
import upgrade from "./upgrade-contract.json";
import shared from "./contract.json";
import type { ProjectState } from "../../src/pokeweb/projectStore";

const [input, output, variant = "base"] = process.argv.slice(2);
if (!input || !output || !["base", "full"].includes(variant)) throw new Error("Expected source ROM, new output ROM, and base|full");
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.protocol !== "file:") throw new Error("Only repository-local assets are allowed");
  return new Response(new Uint8Array(await readFile(url)));
}) as typeof fetch;
const sha = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
function snapshot(project: ProjectState) {
  const records = (values: Record<string, Uint8Array> | undefined) => Object.entries(values ?? {}).map(([key, data]) => [key, sha(data)]).sort();
  return JSON.stringify({ files: { additions: records(project.fileSystem?.additions), replacements: records(project.fileSystem?.replacements), tombstones: project.fileSystem?.tombstones },
    arm9: sha(project.arm9), overlays: records(project.overlays), changes: project.actionChangelog,
    patches: project.patches, injection: project.codeInjection });
}
const bytes = new Uint8Array(await readFile(input));
assert.equal(sha(bytes), upgrade.sourceRomSha256, "Audit requires the pinned input, not a substituted ROM");
const project = await loadProjectFromRomBytes(bytes, basename(input), { selectedNarcs: [] });
const rom = await followerRom(project);
const before = await checkFollowerCompatibility(project, rom, variant as "base" | "full");
assert.ok(before.compatible, JSON.stringify(before.checks.filter(check => !check.passed)));
const modules = upgrade.requiredModules.map(({ path, sha256 }) => {
  const data = readFollowingFile(project, rom, path)!;
  const rpm = parseRpm(data, { allowedMagics: ["DLXF"] });
  assert.equal(sha(data), sha256);
  // Some stripped Upgrade modules carry no game metadata; their exact hash
  // is bound to the pinned IRDO input. Reject a contrary tag if present.
  if (rpm.metadata.PMCGameID !== undefined) assert.equal(rpm.metadata.PMCGameID, "W2");
  return { path, sha256, bytes: data.length, codeBytes: rpm.code.length, bssBytes: rpm.bssSize,
    gameIdMetadata: rpm.metadata.PMCGameID ?? null,
    externalRelocations: rpm.relocations.filter(rel => rel.target.module !== "base").length };
});
let rejected = 0;
async function rejection(label: string, mutate: () => (() => void)) {
  const undo = mutate();
  try {
    const original = snapshot(project);
    const report = await checkFollowerCompatibility(project, rom, variant as "base" | "full");
    assert.equal(report.compatible, false, label);
    await assert.rejects(installFollowerAlpha(project, rom, { riding: variant === "full" }), undefined, label);
    assert.equal(snapshot(project), original, `${label} mutated the project`);
    rejected++;
  } finally { undo(); }
}
const staged = (path: string, data: Uint8Array) => {
  const original = project.fileSystem;
  project.fileSystem = { ...original, additions: { ...original?.additions, [path]: data } };
  return () => { project.fileSystem = original; };
};
for (const { path } of upgrade.requiredModules) {
  await rejection(`changed ${path}`, () => {
    const data = readFollowingFile(project, rom, path)!.slice(); data[data.length - 1] ^= 1;
    return staged(path, data);
  });
  await rejection(`missing ${path}`, () => staged(path, new Uint8Array()));
}
for (const site of [shared.hooks.find(site => site.segment === "ARM9")!, upgrade.nativeAdapters.find(site => site.segment === "ARM9")!]) {
  await rejection(`changed ${site.id}`, () => {
    const original = project.arm9; project.arm9 = original.slice(); project.arm9[site.address - rom.arm9RamAddress] ^= 1;
    return () => { project.arm9 = original; };
  });
}
await rejection("malformed descriptor archive", () => staged(FOLLOWER_DESCRIPTOR_PATH, Uint8Array.of(0, 0, 0, 0)));
await rejection("actual hook conflict", () => {
  const hook = shared.hooks[0];
  return staged("patches/ConflictingFollowerTest.dll", writeRpm({ code: Uint8Array.of(0x70, 0x47, 0, 0), bssSize: 0, baseAddress: 0,
    symbols: [{ name: "conflict", size: 4, address: 0, type: "FUNCTION_THM", attributes: 0 }],
    relocations: [{ sourceSymbolIndex: 0, target: { module: hook.segment, address: hook.address, type: "FULL_COPY" } }], metadata: { PMCGameID: "W2" } }, { ident: "DLXF" }));
});
const fetchAssets = globalThis.fetch;
const fetchSnapshot = snapshot(project);
const fieldName = variant === "base" ? "PokewebFollowingFieldW2Base.dll" : "PokewebFollowingFieldW2.dll";
try {
  globalThis.fetch = (async (input: RequestInfo | URL) => String(input).endsWith(fieldName) ? new Response(Uint8Array.of(0)) : fetchAssets(input)) as typeof fetch;
  await assert.rejects(installFollowerAlpha(project, rom, { riding: variant === "full" }), /fingerprint mismatch/);
  assert.equal(snapshot(project), fetchSnapshot, "Corrupt fetched asset mutated the project");
  rejected++;
} finally { globalThis.fetch = fetchAssets; }
console.log(`${variant}: ${before.checks.length} compatibility checks and ${rejected} atomic rejection cases passed.`);

const installed = await installFollowerAlpha(project, rom, { riding: variant === "full" });
assert.equal(installed.profile, "white2upgrade");
assert.equal(installed.variant, variant);
const once = snapshot(project);
assert.deepEqual(await installFollowerAlpha(project, rom), installed);
assert.equal(snapshot(project), once, "Reinstallation must be idempotent");
await setFollowerAlphaEnabled(project, false, rom);
assert.equal((await readFollowerAlphaInstall(project, rom))?.enabled, false);
await setFollowerAlphaEnabled(project, true, rom);
assert.equal((await readFollowerAlphaInstall(project, rom))?.enabled, true);
// Retain recognition of old owned receipts/workspaces, but not old module
// approval. A refreshed profile must not orphan the user's authored artwork.
for (const target of upgrade.previousSourceRomSha256) {
  const receipt = readFollowingFile(project, rom, FOLLOWER_INSTALL_PATH)!;
  let undo = staged(FOLLOWER_INSTALL_PATH, new TextEncoder().encode(JSON.stringify({ ...installed, targetSha256: target })));
  assert.equal((await readFollowerAlphaInstall(project, rom))?.targetSha256, target); undo();
  const workspace = readFollowerWorkspace(project, rom)!;
  undo = staged(FOLLOWER_MANIFEST_PATH, new TextEncoder().encode(JSON.stringify({ ...workspace, targetSha256: target })));
  assert.equal(readFollowerWorkspace(project, rom)?.targetSha256, target); undo();
  assert.equal(sha(readFollowingFile(project, rom, FOLLOWER_INSTALL_PATH)!), sha(receipt));
}
const receiptUndo = staged(FOLLOWER_INSTALL_PATH, new TextEncoder().encode(JSON.stringify({ ...installed, targetSha256: "0".repeat(64) })));
await assert.rejects(readFollowerAlphaInstall(project, rom), /changed/); receiptUndo();

await removeFollowerAlpha(project, rom);
assert.equal((await readFollowerAlphaInstall(project, rom))?.removed, true);
await installFollowerAlpha(project, rom, { riding: variant === "full" });
// Export only follower-owned edits, not the editor's automatic name repairs.
project.narcs = {};
const exported = await exportModifiedRom(project);
const reopened = await loadProjectFromRomBytes(exported, basename(output), { selectedNarcs: [] });
const reopenedState = await readFollowerAlphaInstall(reopened);
assert.equal(reopenedState?.enabled, true);
assert.equal(reopenedState?.variant, variant);
assert.equal((await checkFollowerCompatibility(reopened)).compatible, true);
for (const part of ["Field", "Events", "Core", "Options", "Battle"]) {
  const name = `PokewebFollowing${part}W2.dll`;
  assert.equal(reopened.codeInjection!.modules!.filter(module => module.fileName === name).length, 1, name);
}
const saved = new NintendoDSRom(exported, { fileData: "view" });
for (const { path, sha256 } of upgrade.requiredModules) assert.equal(sha(saved.getFileByName(path)), sha256, `Rewrote ${path}`);
assert.equal(sha(new Uint8Array(await readFile(input))), sha(bytes), "Source ROM changed");
await writeFile(output, exported, { flag: "wx" });
await writeFile(`${output}.audit.json`, JSON.stringify({ sourceRomSha256: sha(bytes), output: basename(output), outputSha256: sha(exported), variant,
  followerVersion: installed.version, sourceChecks: before.checks.length, atomicRejections: rejected, modules,
  lifecycle: ["install", "idempotent reinstall", "disable", "reenable", "historical receipt/workspace", "remove", "reinstall", "export", "reopen"],
  gameEmulatorValidation: "Not run; CPU tests and cold-boot game acceptance are separate" }, null, 2) + "\n", { flag: "wx" });
console.log(`${variant}: installation, ownership, lifecycle and export/reopen passed; ${basename(output)} written. No save modified or emulator started.`);
