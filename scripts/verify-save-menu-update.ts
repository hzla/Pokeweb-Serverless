import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { NintendoDSRom } from "../src/nds/rom";
import { exportModifiedRom } from "../src/pokeweb/exportRom";
import { loadProjectFromRomBytes } from "../src/pokeweb/loader";
import { getPmcInstallStatus, stageCodeInjectionDll } from "../src/pokeweb/pmcModel";
import { getSaveMenuStatus, installSaveMenu } from "../src/pokeweb/saveMenuModel";

const inputPath = process.argv[2];
if (!inputPath) throw new Error("Usage: vite-node scripts/verify-save-menu-update.ts input.nds");
const source = new Uint8Array(await readFile(inputPath));
const project = await loadProjectFromRomBytes(source, basename(inputPath), { selectedNarcs: [] });
const version = project.session.baseVersion;
assert(version === "W2" || version === "B2");
const dllName = `SaveMenu${version}.dll`;
const dll = new Uint8Array(await readFile(resolve(import.meta.dirname, `../src/assets/codeinjection/${dllName}`)));
const previousFetch = globalThis.fetch;
globalThis.fetch = async (input) => {
  const name = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url).pathname.split("/").at(-1);
  if (!name || !/^(?:SaveMenu[WB]2\.dll|PMC_[WB]2\.rpm)$/u.test(name)) throw new Error(`Unexpected bundled file request: ${name}`);
  return new Response(await readFile(resolve(import.meta.dirname, `../src/assets/codeinjection/${name}`)));
};
try {
  assert(getSaveMenuStatus(project).supported);
  await installSaveMenu(project);
  assert(getPmcInstallStatus(project).installed);
  const path = `patches/${dllName}`;
  const staged = project.fileSystem?.additions?.[path];
  assert.deepEqual(staged, dll);
  assert(getSaveMenuStatus(project).installed);
  assert(!getSaveMenuStatus(project).updateAvailable);

  const entry = project.codeInjection?.modules?.find(module => module.path === path);
  assert(entry);
  entry.version = "0.2.2";
  assert(getSaveMenuStatus(project).updateAvailable);
  await installSaveMenu(project);
  assert.equal(entry.version, "0.2.2", "The old metadata object should have been replaced");
  assert(!getSaveMenuStatus(project).updateAvailable);
  assert.deepEqual(project.fileSystem?.additions?.[path], dll);
  assert.equal(project.codeInjection?.modules?.filter(module => module.path === path).length, 1);
  const exportedBytes = await exportModifiedRom(project);
  const exported = new NintendoDSRom(exportedBytes, { fileData: "view" });
  assert.deepEqual(exported.getFileByName(path), dll);
  if (process.argv[3]) await writeFile(process.argv[3], exportedBytes);
  const skipName = `MainMenuSkip${version}.dll`;
  const skip = new Uint8Array(await readFile(resolve(import.meta.dirname, `../src/assets/codeinjection/${skipName}`)));
  stageCodeInjectionDll(project, skipName, skip, "patches", source);
  const installedEntry = project.codeInjection?.modules?.find(module => module.path === path);
  assert(installedEntry);
  installedEntry.version = "0.2.2";
  await assert.rejects(installSaveMenu(project), /bypass the save menu/u);
  assert.deepEqual(project.fileSystem?.additions?.[`patches/${skipName}`], skip, "The debug patch must remain untouched");
  console.log(`${version}: fresh install, 0.2.2 → 0.2.3 update/export, and active debug-skip refusal passed.`);
} finally {
  globalThis.fetch = previousFetch;
}
