import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NintendoDSRom } from "../src/nds/rom";
import { installBlack2UpgradeWithBundle, type Black2UpgradeInstallBundle } from "../src/pokeweb/black2UpgradeModel";
import { exportModifiedRom } from "../src/pokeweb/exportRom";
import { replaceRomFile } from "../src/pokeweb/fileSystemModel";
import { loadProjectFromRomBytes } from "../src/pokeweb/loader";
import { installPmcBytes, stageCodeInjectionDll } from "../src/pokeweb/pmcModel";
import { PWAN_B2_RUNTIME_FILENAMES } from "../src/pokeweb/pwanAnimationModel";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const input = resolve(process.argv[2] ?? resolve(root, "../cleanblack2.nds"));
const output = resolve(process.argv[3] ?? "/tmp/Black2Upgrade-overworld-debug.nds");
const profile = process.argv[4] ?? "all";
const dataProfile = process.argv[5] ?? "all";
const codeAssets = resolve(root, "src/assets/codeinjection");
const dataAssets = resolve(root, "src/assets/black2upgrade");
const readBytes = async (path: string) => new Uint8Array(await readFile(path));

const allRuntimeNames = ["Black2Upgrade.dll", "Black2UpgradeField.dll", "Black2UpgradePokedex.dll", "Black2UpgradeUI.dll"];
const runtimeNames = profile === "none" || profile === "clean" ? [] : profile === "core" ? allRuntimeNames.slice(0, 1) : allRuntimeNames;
const pwanNames = profile === "all" ? PWAN_B2_RUNTIME_FILENAMES : [];
if (!["clean", "none", "core", "runtime", "all"].includes(profile)) throw new Error(`Unknown debug profile: ${profile}`);

const project = await loadProjectFromRomBytes(new Uint8Array(await readFile(input)), basename(input));
const bundle: Black2UpgradeInstallBundle = {
  packageBytes: await readBytes(resolve(dataAssets, "black2upgrade-data.tar.gz")),
  packageManifestBytes: await readBytes(resolve(dataAssets, "black2upgrade-package-manifest.json")),
  compatibilityBytes: await readBytes(resolve(dataAssets, "black2upgrade-compatibility.json")),
  pmcBytes: await readBytes(resolve(codeAssets, "PMC_B2.rpm")),
  runtimeArtifacts: await Promise.all(runtimeNames.map(async (fileName) => ({ fileName, bytes: await readBytes(resolve(codeAssets, fileName)) }))),
  pwanRuntimeArtifacts: await Promise.all(pwanNames.map(async (fileName) => ({ fileName, bytes: await readBytes(resolve(codeAssets, fileName)) }))),
};

if (profile === "clean") installPmcBytes(project, bundle.pmcBytes, project.originalRomBytes!);
else {
  await installBlack2UpgradeWithBundle(project, bundle);
  const groups: Record<string, string[]> = {
    tables: ["a/0/1/6", "a/0/1/8", "a/0/1/9", "a/0/2/1", "a/0/2/4"],
    graphics: ["a/0/0/4", "a/0/0/6", "a/0/0/7", "a/0/1/1", "a/0/2/5", "a/0/6/5", "a/0/8/2", "a/1/2/5", "a/1/6/5", "a/2/1/3"],
    text: ["a/0/0/2", "a/0/0/3"],
  };
  const allDataPaths = Object.values(groups).flat();
  const keep = new Set(dataProfile === "all" ? allDataPaths : groups[dataProfile] ?? dataProfile.split(",").filter(Boolean));
  const cleanRom = new NintendoDSRom(project.originalRomBytes!);
  for (const path of allDataPaths) {
    if (keep.has(path)) continue;
    const fileId = cleanRom.filenames.idOf(path);
    if (fileId !== undefined) replaceRomFile(project, cleanRom, fileId, cleanRom.files[fileId]);
  }
  if (dataProfile !== "all" && project.fileSystem?.additions) {
    delete project.fileSystem.additions["zz_pokeweb_pwan/pwan.narc"];
  }
  if (dataProfile !== "all" && dataProfile !== "graphics" && dataProfile !== "arm9") {
    project.arm9 = cleanRom.arm9;
    project.arm9Dirty = false;
  }
}
stageCodeInjectionDll(project, "MainMenuSkipB2.dll", await readBytes(resolve(codeAssets, "MainMenuSkipB2.dll")), "patches");
const romBytes = await exportModifiedRom(project);
await writeFile(output, romBytes);
console.log(`Built ${output} (${romBytes.length} bytes, profile ${profile}, data ${dataProfile}).`);
