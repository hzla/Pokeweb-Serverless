import { createHash } from "node:crypto";
import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const buildDir = resolve(
  process.env.BLACK2UPGRADE_BUILD_DIR ?? resolve(root, "../../White2Upgrade-Original-pokeweb/build-stripped/black2upgrade-artifacts"),
);
const codeAssetDir = resolve(root, "src/assets/codeinjection");
const dataAssetDir = resolve(root, "src/assets/black2upgrade");
const syncManifestPath = resolve(dataAssetDir, "artifact-manifest.json");
const checkOnly = process.argv.includes("--check");

const specs = [
  { name: "Black2Upgrade.dll", destination: codeAssetDir, kind: "runtime" },
  { name: "Black2UpgradeField.dll", destination: codeAssetDir, kind: "runtime" },
  { name: "Black2UpgradePokedex.dll", destination: codeAssetDir, kind: "runtime" },
  { name: "Black2UpgradeUI.dll", destination: codeAssetDir, kind: "runtime" },
  { name: "black2upgrade-compatibility.json", destination: dataAssetDir, kind: "compatibility" },
  { name: "black2upgrade-heap-audit.json", destination: dataAssetDir, kind: "heap-audit" },
  { name: "black2upgrade-package-manifest.json", destination: dataAssetDir, kind: "package-manifest" },
  { name: "black2upgrade-data.tar.gz", destination: dataAssetDir, kind: "package" },
];

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const exists = async (path) => {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

const artifacts = {};
for (const spec of specs) {
  const bytes = await readFile(resolve(buildDir, spec.name));
  if (spec.kind === "runtime" && bytes.subarray(0, 4).toString("ascii") !== "DLXF") {
    throw new Error(`${spec.name} is not a DLXF runtime artifact.`);
  }
  artifacts[spec.name] = { kind: spec.kind, size: bytes.length, sha256: sha256(bytes) };
}
const manifestText = `${JSON.stringify({ format: 1, source: "White2Upgrade-Original-pokeweb/build-stripped/black2upgrade-artifacts", artifacts }, null, 2)}\n`;

if (checkOnly) {
  const failures = [];
  for (const spec of specs) {
    const destination = resolve(spec.destination, spec.name);
    if (!(await exists(destination))) failures.push(`${spec.name} is missing`);
    else if (sha256(await readFile(destination)) !== artifacts[spec.name].sha256) failures.push(`${spec.name} differs from the runtime build`);
  }
  if (!(await exists(syncManifestPath)) || (await readFile(syncManifestPath, "utf8")) !== manifestText) failures.push("artifact-manifest.json is stale");
  if (failures.length > 0) throw new Error(`Black2Upgrade artifact check failed:\n- ${failures.join("\n- ")}`);
  console.log(`Verified ${specs.length} Black2Upgrade artifacts.`);
  process.exit(0);
}

await mkdir(codeAssetDir, { recursive: true });
await mkdir(dataAssetDir, { recursive: true });
for (const spec of specs) await copyFile(resolve(buildDir, spec.name), resolve(spec.destination, spec.name));
await writeFile(syncManifestPath, manifestText);
console.log(`Synchronized ${specs.length} Black2Upgrade artifacts.`);
