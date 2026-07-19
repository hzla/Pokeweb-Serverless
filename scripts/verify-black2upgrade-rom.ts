import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readU32 } from "../src/nds/binary";
import { NintendoDSRom } from "../src/nds/rom";
import {
  BLACK2UPGRADE_MARKER_PATH,
  BLACK2UPGRADE_RUNTIME_FILENAMES,
  getBlack2UpgradeInstallStatus,
  installBlack2UpgradeWithBundle,
  type Black2UpgradeInstallBundle,
} from "../src/pokeweb/black2UpgradeModel";
import { loadProjectFromRomBytes } from "../src/pokeweb/loader";
import { listCodeInjectionDlls } from "../src/pokeweb/pmcModel";
import { PWAN_B2_RUNTIME_FILENAMES } from "../src/pokeweb/pwanAnimationModel";
import { getPokemonSpriteEntry, resolvePokemonSpriteId } from "../src/pokeweb/pokemonSpriteModel";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const runtimeRoot = resolve(root, "../../White2Upgrade-Original-pokeweb");
const romPath = resolve(process.argv[2] ?? resolve(runtimeRoot, "build-stripped/Black2Upgrade.nds"));
const cleanRomPath = resolve(process.argv[3] ?? resolve(root, "../cleanblack2.nds"));
const codeAssets = resolve(root, "src/assets/codeinjection");
const dataAssets = resolve(root, "src/assets/black2upgrade");
const readBytes = async (path: string) => new Uint8Array(await readFile(path));
const romBytes = await readBytes(romPath);
const rom = new NintendoDSRom(romBytes);
const cleanRom = new NintendoDSRom(await readBytes(cleanRomPath));
if (rom.idCode !== "IREO") throw new Error(`Expected IREO, found ${rom.idCode}.`);
for (const path of [
  BLACK2UPGRADE_MARKER_PATH,
  ...BLACK2UPGRADE_RUNTIME_FILENAMES.map((name) => `patches/${name}`),
  ...PWAN_B2_RUNTIME_FILENAMES.map((name) => `patches/${name}`),
  "zz_pokeweb_pwan/pwan.narc",
  "data/black2upgrade/poke_form_list.bin",
  "data/black2upgrade/pokeicon_palette_map.bin",
  "data/black2upgrade/type_chart.bin",
  "data/black2upgrade/type_palette_map.bin",
]) {
  if (rom.filenames.idOf(path) === undefined) throw new Error(`Canonical ROM is missing ${path}.`);
}
for (const path of ["poke_form_list.bin", "pokeicon_palette_map.bin", "type_chart.bin", "type_palette_map.bin"]) {
  if (rom.filenames.idOf(path) !== undefined) throw new Error(`B2-only sidecar was incorrectly added at the ROM root: ${path}.`);
}
const fatOffset = readU32(romBytes, 0x48);
const fileStart = (path: string): number => {
  const fileId = rom.fileId(path);
  return readU32(romBytes, fatOffset + fileId * 8);
};
const firstExpandedArchiveOffset = fileStart("a/0/0/4");
for (const path of [
  "overlay/overlay_0344.bin",
  ...BLACK2UPGRADE_RUNTIME_FILENAMES.map((name) => `patches/${name}`),
  ...PWAN_B2_RUNTIME_FILENAMES.map((name) => `patches/${name}`),
]) {
  if (fileStart(path) >= firstExpandedArchiveOffset) throw new Error(`PMC runtime file is not physically prioritized: ${path}.`);
}
for (const path of ["a/0/0/3", "a/0/0/8", "a/0/0/9", "a/0/5/6", "a/0/9/1", "a/0/9/2", "a/1/2/6", "a/1/2/7"]) {
  const before = cleanRom.getFileByName(path);
  const after = rom.getFileByName(path);
  if (before.length !== after.length || before.some((value, index) => value !== after[index])) throw new Error(`B2-native preserved archive changed: ${path}.`);
}

const project = await loadProjectFromRomBytes(romBytes, "Black2Upgrade.nds", { expandSprites: true });
if (getBlack2UpgradeInstallStatus(project).state !== "installed") throw new Error(getBlack2UpgradeInstallStatus(project).message);
const paths = new Set(listCodeInjectionDlls(project).map((module) => module.path));
for (const name of BLACK2UPGRADE_RUNTIME_FILENAMES) if (!paths.has(`patches/${name}`)) throw new Error(`Reload did not detect ${name}.`);

const personal = project.narcs.personal;
if (!personal || personal.rawFiles.length < 1024) throw new Error("Expanded personal data does not cover species 1-1023.");
if ((project.narcs.learnsets?.fileCount ?? 0) < 1024 || (project.narcs.evolutions?.fileCount ?? 0) < 1024) throw new Error("Expanded learnset/evolution data does not cover species 1-1023.");
if ((project.narcs.moves?.fileCount ?? 0) < 900 || (project.narcs.items?.fileCount ?? 0) < 630) throw new Error("Expanded move/item tables have unexpected counts.");
const iconFiles = project.narcs.pokemon_icons?.rawFiles;
if (!iconFiles) throw new Error("Expanded icon archive was not loaded.");
for (let speciesId = 1; speciesId <= 1023; speciesId += 1) {
  if (!personal.rawFiles[speciesId]?.length) throw new Error(`Species ${speciesId} has no personal record.`);
  const spriteId = resolvePokemonSpriteId(project, speciesId);
  const entry = getPokemonSpriteEntry(project, spriteId);
  if (!entry.files[0]?.length || !entry.files[9]?.length || !entry.files[18]?.length) throw new Error(`Species ${speciesId} has incomplete front/back/palette assets.`);
  const iconIndex = speciesId >= 722 && speciesId <= 809
    ? 1904 + (speciesId - 722) * 2
    : speciesId >= 810
      ? 2408 + (speciesId - 810) * 2
      : 8 + spriteId * 2;
  if (!iconFiles[iconIndex]?.length) throw new Error(`Species ${speciesId} has no icon asset.`);
}
personal.rawFiles[1] = personal.rawFiles[1]!.slice();
personal.rawFiles[1]![0] ^= 1;
personal.dirty.add(1);
const preservedByte = personal.rawFiles[1]![0];

const bundle: Black2UpgradeInstallBundle = {
  packageBytes: await readBytes(resolve(dataAssets, "black2upgrade-data.tar.gz")),
  packageManifestBytes: await readBytes(resolve(dataAssets, "black2upgrade-package-manifest.json")),
  compatibilityBytes: await readBytes(resolve(dataAssets, "black2upgrade-compatibility.json")),
  pmcBytes: await readBytes(resolve(codeAssets, "PMC_B2.rpm")),
  runtimeArtifacts: await Promise.all(BLACK2UPGRADE_RUNTIME_FILENAMES.map(async (fileName) => ({ fileName, bytes: await readBytes(resolve(codeAssets, fileName)) }))),
  pwanRuntimeArtifacts: await Promise.all(PWAN_B2_RUNTIME_FILENAMES.map(async (fileName) => ({ fileName, bytes: await readBytes(resolve(codeAssets, fileName)) }))),
};
await installBlack2UpgradeWithBundle(project, bundle);
if (project.narcs.personal?.rawFiles[1]?.[0] !== preservedByte) throw new Error("Runtime-only update replaced edited expansion data.");
console.log(`Verified canonical Black2Upgrade ROM, reload detection, and runtime-only preservation (${romBytes.length} bytes).`);
