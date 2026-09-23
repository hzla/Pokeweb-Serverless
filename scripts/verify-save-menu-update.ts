import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { NintendoDSRom } from "../src/nds/rom";
import { exportModifiedRom } from "../src/pokeweb/exportRom";
import { loadProjectFromRomBytes } from "../src/pokeweb/loader";
import { getPmcInstallStatus } from "../src/pokeweb/pmcModel";
import { getSaveMenuStatus, installSaveMenu } from "../src/pokeweb/saveMenuModel";

const inputPath = process.argv[2];
if (!inputPath) throw new Error("Usage: vite-node scripts/verify-save-menu-update.ts input.nds");
const source = new Uint8Array(await readFile(inputPath));
const project = await loadProjectFromRomBytes(source, basename(inputPath), { selectedNarcs: [] });
assert(getPmcInstallStatus(project).installed, `Input ROM must already contain PMC: ${getPmcInstallStatus(project).message}`);

const dll = new Uint8Array(await readFile(resolve(import.meta.dirname, "../src/assets/codeinjection/SaveMenuW2.dll")));
const previousFetch = globalThis.fetch;
globalThis.fetch = async () => new Response(dll);
try {
  assert(getSaveMenuStatus(project).supported);
  await installSaveMenu(project);
  const staged = project.fileSystem?.additions?.["patches/SaveMenuW2.dll"];
  assert.deepEqual(staged, dll);
  assert(getSaveMenuStatus(project).installed);
  assert(!getSaveMenuStatus(project).updateAvailable);

  const entry = project.codeInjection?.modules?.find(module => module.path === "patches/SaveMenuW2.dll");
  assert(entry);
  entry.version = "0.1.8";
  assert(getSaveMenuStatus(project).updateAvailable);
  await installSaveMenu(project);
  assert.equal(entry.version, "0.1.8", "The old metadata object should have been replaced");
  assert(!getSaveMenuStatus(project).updateAvailable);
  assert.deepEqual(project.fileSystem?.additions?.["patches/SaveMenuW2.dll"], dll);
  assert.equal(project.codeInjection?.modules?.filter(module => module.path === "patches/SaveMenuW2.dll").length, 1);
  const exported = new NintendoDSRom(await exportModifiedRom(project), { fileData: "view" });
  assert.deepEqual(exported.getFileByName("patches/SaveMenuW2.dll"), dll);
  console.log("Fresh Pokeweb install and staged 0.1.8 → 0.1.9 update/export passed; one module remains.");
} finally {
  globalThis.fetch = previousFetch;
}
