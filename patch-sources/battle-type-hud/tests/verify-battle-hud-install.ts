import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { NintendoDSRom } from "../src/nds/rom";
import { NARC } from "../src/nds/narc";
import { decompressNitro } from "../src/pokeweb/pokemonSpriteModel";
import { createHash } from "node:crypto";
import expansion from "../src/assets/codeinjection/battleTypeHudPanelExpansion.json";
import { loadProjectFromRomBytes } from "../src/pokeweb/loader";
import { getBattleTypeHudStatus, installBattleTypeHud, uninstallBattleTypeHud, getMoveEffectivenessStatus, installMoveEffectiveness, uninstallMoveEffectiveness } from "../src/pokeweb/battleTypeHudModel";
import { stageCodeInjectionDll } from "../src/pokeweb/pmcModel";
import { exportModifiedRom } from "../src/pokeweb/exportRom";
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = input instanceof URL ? input : new URL(String(input));
  return url.protocol === "file:" ? new Response(new Uint8Array(await readFile(url))) : nativeFetch(input, init);
};
const reports = [];
for (const path of process.argv.slice(2)) {
  const bytes = new Uint8Array(await readFile(path));
  const project = await loadProjectFromRomBytes(bytes, path, { selectedNarcs: [] });
  const before = getBattleTypeHudStatus(project); if (!before.compatible) throw new Error(before.message);
  await installBattleTypeHud(project);
  if (getMoveEffectivenessStatus(project).installed) throw new Error("Icons installed move preview.");
  await installMoveEffectiveness(project);
  const status = getBattleTypeHudStatus(project); if (!status.installed || !status.compatible) throw new Error(status.message);
  const result = await exportModifiedRom(project); const rom = new NintendoDSRom(result);
  const originalArchive = new NARC(new NintendoDSRom(bytes).getFileByName("a/0/1/1")!);
  const expandedArchive = new NARC(rom.getFileByName("a/0/1/1")!);
  const unpack = (raw: Uint8Array) => raw[0] === 0x10 || raw[0] === 0x11 ? decompressNitro(raw) : raw;
  for (let i = 0; i < originalArchive.files.length; ++i) {
    const change = expansion[String(i) as keyof typeof expansion];
    if (change) {
      if (createHash("sha256").update(unpack(expandedArchive.files[i]!)).digest("hex") !== change.patchedSha256) throw new Error(`Panel resource ${i} was not expanded.`);
    } else if (!Buffer.from(expandedArchive.files[i]!).equals(Buffer.from(originalArchive.files[i]!))) throw new Error(`Unrelated battle member ${i} changed.`);
  }
  const expected = new Uint8Array(await readFile(new URL(`../src/assets/codeinjection/TypeIcons${project.session.baseVersion}.dll`, import.meta.url)));
  const installed = rom.getFileByName(status.dllPath!);
  if (!installed || !Buffer.from(installed).equals(Buffer.from(expected))) throw new Error("Exported DLL differs.");
  const reimported = await loadProjectFromRomBytes(result, "reimported.nds", { selectedNarcs: [] });
  const reimportedStatus = getBattleTypeHudStatus(reimported);
  if (!getMoveEffectivenessStatus(reimported).installed) throw new Error("Move preview lost on reimport.");
  if (!reimportedStatus.installed || !reimportedStatus.compatible || reimportedStatus.canUninstall) throw new Error("Reimport detection failed.");
  await installBattleTypeHud(reimported);
  const reinstalled = new NintendoDSRom(await exportModifiedRom(reimported));
  if (!Buffer.from(reinstalled.getFileByName("a/0/1/1")!).equals(Buffer.from(rom.getFileByName("a/0/1/1")!))) throw new Error("Reinstall changed the expanded panel again.");

  // Imported 0.3.8 ROMs have the original extension at x=-80. Upgrade both
  // their DLL and NCER, then verify that no other archive member was touched.
  const legacy = await loadProjectFromRomBytes(result, "legacy-source.nds", { selectedNarcs: [] });
  const legacyRom = new NintendoDSRom(result);
  const legacyArchive = new NARC(legacyRom.getFileByName("a/0/1/1")!);
  const legacyCell = unpack(legacyArchive.files[439]!).slice(); legacyCell[0x46] = 0xb0;
  if (createHash("sha256").update(legacyCell).digest("hex") !== expansion["439"].previous[0]!.patchedSha256) throw new Error("Legacy cell fixture differs.");
  legacyArchive.files[439] = legacyCell;
  legacy.fileSystem ??= {}; legacy.fileSystem.replacements ??= {};
  legacy.fileSystem.replacements[legacyRom.filenames.idOf("a/0/1/1")!] = legacyArchive.save();
  const oldDll = new Uint8Array(await readFile(new URL(`../src/test/fixtures/battle-type-hud/TypeIcons${project.session.baseVersion}-0.3.8.dll`, import.meta.url)));
  stageCodeInjectionDll(legacy, `TypeIcons${project.session.baseVersion}.dll`, oldDll);
  const legacyImported = await loadProjectFromRomBytes(await exportModifiedRom(legacy), "legacy-imported.nds", { selectedNarcs: [] });
  if (!getBattleTypeHudStatus(legacyImported).updateAvailable) throw new Error("Legacy DLL was not recognized.");
  await installBattleTypeHud(legacyImported);
  const upgradedRom = new NintendoDSRom(await exportModifiedRom(legacyImported));
  const upgradedArchive = new NARC(upgradedRom.getFileByName("a/0/1/1")!);
  if (!Buffer.from(upgradedRom.getFileByName(status.dllPath!)!).equals(Buffer.from(expected))) throw new Error("Legacy DLL upgrade failed.");
  for (let i = 0; i < expandedArchive.files.length; ++i) if (!Buffer.from(unpack(upgradedArchive.files[i]!)).equals(Buffer.from(unpack(expandedArchive.files[i]!)))) throw new Error(`Legacy upgrade changed member ${i} unexpectedly.`);
  uninstallBattleTypeHud(project);
  if (getBattleTypeHudStatus(project).installed) throw new Error("Staged uninstall failed.");
  if (!getMoveEffectivenessStatus(project).installed) throw new Error("Icons uninstall removed move preview.");
  uninstallMoveEffectiveness(project);
  if (getMoveEffectivenessStatus(project).installed) throw new Error("Move preview uninstall failed.");
  const restored = new NARC(new NintendoDSRom(await exportModifiedRom(project)).getFileByName("a/0/1/1")!);
  for (let i = 0; i < originalArchive.files.length; ++i) if (!Buffer.from(unpack(restored.files[i]!)).equals(Buffer.from(unpack(originalArchive.files[i]!)))) throw new Error(`Uninstall did not restore member ${i}.`);
  reports.push({ independentComponents: true, game: project.session.baseVersion, initial: before, installed: status, reimported: reimportedStatus, stagedUninstall: true, imported038Upgrade: "DLL and prior NCER upgraded; all unrelated members preserved", panelExpansion: "438/439 only; exact hashes; idempotent reinstall; native resources restored on uninstall" });
}
const out = resolve("../work/battle-type-hud/build"); await mkdir(out, { recursive: true });
await writeFile(resolve(out, "pokeweb-install-verification.json"), JSON.stringify(reports, null, 2)+"\n");
console.log(JSON.stringify(reports, null, 2));
