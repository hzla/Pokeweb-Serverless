import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { loadProjectFromRomBytes } from "../../src/pokeweb/loader";
import { NintendoDSRom } from "../../src/nds/rom";
import { NARC } from "../../src/nds/narc";
import { exportModifiedRom } from "../../src/pokeweb/exportRom";
import { installBattleTypeHud, getBattleTypeHudStatus, uninstallBattleTypeHud } from "../../src/pokeweb/battleTypeHudModel";
import { decompressNitro } from "../../src/pokeweb/pokemonSpriteModel";
import { listCodeInjectionDlls } from "../../src/pokeweb/pmcModel";
import { stripTypeIconBorder } from "../../src/pokeweb/typeIconBorderResources";
const [input, output] = process.argv.slice(2);
if (!input) throw new Error("Supply a BW2 ROM and optional new output filename.");
globalThis.fetch = async input => { const url = input instanceof URL ? input : new URL(String(input)); assert.equal(url.protocol, "file:"); return new Response(new Uint8Array(await readFile(url))); };
const source = new Uint8Array(await readFile(input)), original = new NintendoDSRom(source, { fileData: "view" });
const project = await loadProjectFromRomBytes(source, "border.nds", { selectedNarcs: ["message_texts"] });
const modules = listCodeInjectionDlls(project).map(module => ({ ...module, bytes: original.getFileByName(module.path).slice() }));
const unpack = (b: Uint8Array) => b[0] === 16 || b[0] === 17 ? decompressNitro(b) : b;
const initial = new NARC(original.getFileByName("a/0/1/1"));
for (const variant of ["letters", "circular"] as const) {
  await installBattleTypeHud(project, variant, "#d6d6d6");
  const status = getBattleTypeHudStatus(project);
  assert.equal(status.compatible, true); assert.equal(status.borderColor, "#d6d6d6"); assert.equal(status.updateAvailable, false);
  const exported = await exportModifiedRom(project), rom = new NintendoDSRom(exported);
  for (const module of modules) if (!/^TypeIcons/.test(module.fileName)) assert.deepEqual(rom.getFileByName(module.path), module.bytes);
  const archive = new NARC(rom.getFileByName("a/0/1/1"));
  for (const member of [435,438,441,444]) {
    const raw = stripTypeIconBorder(unpack(archive.files[member]!), String(member), status.graphicsProfile === "redux");
    const before = unpack(initial.files[member]!);
    assert.deepEqual(raw.subarray(48, Math.min(before.length, raw.length)), before.subarray(48, Math.min(before.length, raw.length)));
  }
  for (const member of [430,431,432,433,456]) assert.deepEqual(unpack(archive.files[member]!), unpack(initial.files[member]!));
  const reopened = await loadProjectFromRomBytes(exported, "reopened.nds", { selectedNarcs: ["message_texts"] });
  assert.equal(getBattleTypeHudStatus(reopened).compatible, true); assert.equal(getBattleTypeHudStatus(reopened).borderColor, "#d6d6d6");
  await installBattleTypeHud(reopened, variant);
  assert.equal(getBattleTypeHudStatus(reopened).borderColor, "#d6d6d6");
  if (output && variant === "circular") await writeFile(output, exported, { flag: "wx" });
  console.log(variant, "custom color, native art/palettes, existing DLLs, export/reimport/reinstall passed");
}
await installBattleTypeHud(project, "solid");
assert.equal(getBattleTypeHudStatus(project).compatible, true);
assert.equal(getBattleTypeHudStatus(project).borderColor, undefined);
await installBattleTypeHud(project, "letters", "#00ff00");
if (getBattleTypeHudStatus(project).canUninstall) {
  uninstallBattleTypeHud(project);
  const restored = new NARC(new NintendoDSRom(await exportModifiedRom(project)).getFileByName("a/0/1/1"));
  for (let i = 0; i < initial.files.length; ++i) assert.deepEqual(unpack(restored.files[i]!), unpack(initial.files[i]!));
  console.log("Staged removal restores every native battle archive member.");
}
