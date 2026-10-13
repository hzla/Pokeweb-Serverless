import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { NintendoDSRom } from "../src/nds/rom";
import { NARC } from "../src/nds/narc";
import { loadProjectFromRomBytes } from "../src/pokeweb/loader";
import { exportModifiedRom } from "../src/pokeweb/exportRom";
import { checkFollowerCompatibility, installFollowerAlpha, readFollowerAlphaInstall, removeFollowerAlpha } from "../src/pokeweb/followingPokemonProject";
import { getBattleTypeHudStatus, getMoveEffectivenessStatus, installBattleTypeHud, installMoveEffectiveness, uninstallBattleTypeHud, uninstallMoveEffectiveness } from "../src/pokeweb/battleTypeHudModel";
import { decompressNitro } from "../src/pokeweb/pokemonSpriteModel";
import { localizedAssetVariant } from "../src/pokeweb/translationAssets";
import expansion from "../src/assets/codeinjection/battleTypeHudPanelExpansion.json";
import hudManifest from "../src/assets/codeinjection/battleTypeHudManifest.json";

const [inputPath, reportPath] = process.argv.slice(2);
if (!reportPath || resolve(inputPath) === resolve(reportPath)) throw new Error("Usage: verify-white2-italian-patches.ts LOCALIZED.nds REPORT.json");
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const bytes = new Uint8Array(await readFile(inputPath)), original = new NintendoDSRom(bytes, { fileData: "view" });
const originalHash = sha(bytes);
assert(["IRDO", "IREO"].includes(original.idCode));
const version = original.idCode === "IREO" ? "B2" : "W2";
globalThis.fetch = (async (value: RequestInfo | URL) => {
  const url = value instanceof URL ? value : new URL(value instanceof Request ? value.url : String(value));
  try {
    return new Response(new Uint8Array(await readFile(url.protocol === "file:" ? url : new URL(`../src/assets/codeinjection/${url.pathname.split("/").pop()}`, import.meta.url))));
  } catch { return new Response(undefined, { status: 404 }); }
}) as typeof fetch;
const project = await loadProjectFromRomBytes(bytes, basename(inputPath), { selectedNarcs: [] });
const following = await checkFollowerCompatibility(project);
assert(following.compatible, JSON.stringify(following));
assert(following.checks.every(check => check.passed));
// The browser persists the base ROM before installing. Exercise that path,
// both runtime variants, and the installation receipt after export/reload.
const request = <T>(result: T): IDBRequest<T> => {
  const item = { result } as IDBRequest<T>;
  queueMicrotask(() => item.onsuccess?.(new Event("success")));
  return item;
};
const previousIndexedDb = globalThis.indexedDB;
globalThis.indexedDB = { open: () => request({ transaction: () => ({ objectStore: () => ({ get: () => request(bytes) }) }), close: () => {} }) } as unknown as IDBFactory;
try {
  for (const riding of [false, true]) {
    const fresh = await loadProjectFromRomBytes(bytes, basename(inputPath), { selectedNarcs: [] });
    delete fresh.originalRomBytes;
    const receipt = await installFollowerAlpha(fresh, undefined, { riding });
    assert.equal(receipt.profile, version === "B2" ? "black2" : "stock");
    assert.equal(receipt.variant, riding ? "full" : "base");
    assert.deepEqual(await installFollowerAlpha(fresh, undefined, { riding }), receipt);
    const reopened = await loadProjectFromRomBytes(await exportModifiedRom(fresh), "localized-following-check.nds", { selectedNarcs: [] });
    assert.deepEqual(await readFollowerAlphaInstall(reopened), receipt);
    await removeFollowerAlpha(reopened);
    assert.equal((await readFollowerAlphaInstall(reopened))?.removed, true);
  }
} finally { globalThis.indexedDB = previousIndexedDb; }
const before = new NARC(original.getFileByName("a/0/1/1"));
const unpack = (raw: Uint8Array) => raw[0] === 0x10 || raw[0] === 0x11 ? decompressNitro(raw) : raw;
await installBattleTypeHud(project); await installMoveEffectiveness(project);
const output = await exportModifiedRom(project), exported = new NintendoDSRom(output, { fileData: "view" });
const after = new NARC(exported.getFileByName("a/0/1/1"));
for (let member = 0; member < before.files.length; member++) {
  const key = String(member);
  const change = key in hudManifest.games[version].resources ? expansion[key as keyof typeof expansion] : undefined;
  if (change) assert.equal(sha(unpack(after.files[member])), localizedAssetVariant(version, "a/0/1/1", member, sha(unpack(before.files[member])))?.expandedSha256 ?? change.patchedSha256);
  else assert.deepEqual(after.files[member], before.files[member], `Unrelated localized battle resource ${member}`);
}
const reopened = await loadProjectFromRomBytes(output, "localized-hud-check.nds", { selectedNarcs: [] });
assert(getBattleTypeHudStatus(reopened).installed && getBattleTypeHudStatus(reopened).compatible);
assert(getMoveEffectivenessStatus(reopened).installed && getMoveEffectivenessStatus(reopened).compatible);
for (const variant of ["circular", "solid", "letters"] as const) {
  await installBattleTypeHud(reopened, variant);
  const rom = new NintendoDSRom(await exportModifiedRom(reopened), { fileData: "view" });
  const filename = variant === "letters" ? `TypeIcons${version}.dll` : variant === "circular" ? `TypeIconsCircular${version}.dll` : `TypeIconsSolid${version}.dll`;
  assert.deepEqual(rom.getFileByName(getBattleTypeHudStatus(reopened).dllPath!), new Uint8Array(await readFile(new URL(`../src/assets/codeinjection/${filename}`, import.meta.url))));
  assert.deepEqual(rom.getFileByName("a/0/1/1"), exported.getFileByName("a/0/1/1"), "Reinstall expanded a panel twice");
}
uninstallBattleTypeHud(project); uninstallMoveEffectiveness(project);
const restored = new NARC(new NintendoDSRom(await exportModifiedRom(project), { fileData: "view" }).getFileByName("a/0/1/1"));
for (let member = 0; member < before.files.length; member++) assert.deepEqual(unpack(restored.files[member]), unpack(before.files[member]), `Uninstall did not restore localized resource ${member}`);
// Exact regional hashes are accepted; arbitrary edited artwork still fails.
const edited = await loadProjectFromRomBytes(bytes, "edited-localized.nds", { selectedNarcs: [] });
const damaged = new NARC(original.getFileByName("a/0/1/1")); damaged.files[434] = unpack(damaged.files[434]).slice(); damaged.files[434][damaged.files[434].length - 1] ^= 1;
edited.fileSystem ??= {}; edited.fileSystem.replacements = { [original.fileId("a/0/1/1")]: damaged.save() };
await assert.rejects(() => installBattleTypeHud(edited), /434/u);
assert.equal(sha(new Uint8Array(await readFile(inputPath))), originalHash);
const report = { version, sourceSha256: originalHash, followingUsProfile: { compatible: following.compatible, checksPassed: following.checks.length, persistedRomInstall: true, baseAndRidingVariants: true, reinstallExportReloadRemove: true }, battleHud: { regionalHashesAndExpansion: true, stockUsDlls: true, movePreviewCoexistence: true, exportReload: true, threeVariantsAndIdempotence: true, uninstallRestoresRegionalArt: true, unknownEditedArtRejected: true }, sourceUnchanged: true };
await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify(report));
