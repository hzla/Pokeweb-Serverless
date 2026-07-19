import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { installBlack2UpgradeWithBundle, type Black2UpgradeInstallBundle } from "../src/pokeweb/black2UpgradeModel";
import { exportModifiedRom } from "../src/pokeweb/exportRom";
import { loadProjectFromRomBytes } from "../src/pokeweb/loader";
import { PWAN_B2_RUNTIME_FILENAMES } from "../src/pokeweb/pwanAnimationModel";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const runtimeRoot = resolve(root, "../../White2Upgrade-Original-pokeweb");
const input = resolve(process.argv[2] ?? resolve(root, "../cleanblack2.nds"));
const output = resolve(process.argv[3] ?? resolve(runtimeRoot, "build-stripped/Black2Upgrade.nds"));
const codeAssets = resolve(root, "src/assets/codeinjection");
const dataAssets = resolve(root, "src/assets/black2upgrade");

const bytes = new Uint8Array(await readFile(input));
const project = await loadProjectFromRomBytes(bytes, "cleanblack2.nds");
const readBytes = async (path: string) => new Uint8Array(await readFile(path));
const runtimeNames = ["Black2Upgrade.dll", "Black2UpgradeField.dll", "Black2UpgradePokedex.dll", "Black2UpgradeUI.dll"];
const bundle: Black2UpgradeInstallBundle = {
  packageBytes: await readBytes(resolve(dataAssets, "black2upgrade-data.tar.gz")),
  packageManifestBytes: await readBytes(resolve(dataAssets, "black2upgrade-package-manifest.json")),
  compatibilityBytes: await readBytes(resolve(dataAssets, "black2upgrade-compatibility.json")),
  pmcBytes: await readBytes(resolve(codeAssets, "PMC_B2.rpm")),
  runtimeArtifacts: await Promise.all(runtimeNames.map(async (fileName) => ({ fileName, bytes: await readBytes(resolve(codeAssets, fileName)) }))),
  pwanRuntimeArtifacts: await Promise.all(PWAN_B2_RUNTIME_FILENAMES.map(async (fileName) => ({ fileName, bytes: await readBytes(resolve(codeAssets, fileName)) }))),
};
await installBlack2UpgradeWithBundle(project, bundle);
const romBytes = await exportModifiedRom(project);
await writeFile(output, romBytes);
console.log(`Built ${output} (${romBytes.length} bytes).`);
