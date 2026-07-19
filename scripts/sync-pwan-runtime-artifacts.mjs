import { createHash } from "node:crypto";
import { access, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, "..");
const buildDir = resolve(
  process.env.PWAN_RUNTIME_BUILD_DIR ??
    resolve(root, "../../White2Upgrade-Original-pokeweb/build-stripped/src"),
);
const assetDir = resolve(root, "src/assets/codeinjection");
const manifestPath = resolve(assetDir, "pwan-runtime-manifest.json");
const legacyAssetPath = resolve(assetDir, "PokewebPwanW2.dll");
const checkOnly = process.argv.includes("--check");

const artifactSpecs = [
  { name: "PokewebPwanSummaryW2.dll", gameId: "W2", scope: "summary" },
  { name: "PokewebPwanBattleW2.dll", gameId: "W2", scope: "battle" },
  { name: "PokewebPwanMiscW2.dll", gameId: "W2", scope: "misc" },
  { name: "PokewebPwanSummaryB2.dll", gameId: "B2", scope: "summary" },
  { name: "PokewebPwanBattleB2.dll", gameId: "B2", scope: "battle" },
  { name: "PokewebPwanMiscB2.dll", gameId: "B2", scope: "misc" },
  { name: "PokewebPwanLegacyRetiredW2.dll", gameId: "W2", scope: "retirement" },
];
const artifactNames = artifactSpecs.map((artifact) => artifact.name);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

const artifacts = {};
for (const { name, gameId, scope } of artifactSpecs) {
  const source = resolve(buildDir, name);
  const bytes = await readFile(source);
  if (bytes.subarray(0, 4).toString("ascii") !== "DLXF") {
    throw new Error(`${source} is not a DLXF runtime artifact.`);
  }
  artifacts[name] = { gameId, scope, sha256: sha256(bytes), size: bytes.length };
}

const manifest = {
  format: 1,
  source: "White2Upgrade-Original-pokeweb/build-stripped/src",
  artifacts,
};
const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;

if (checkOnly) {
  const failures = [];
  for (const name of artifactNames) {
    const assetPath = resolve(assetDir, name);
    if (!(await exists(assetPath))) {
      failures.push(`${name} is missing`);
      continue;
    }
    const bytes = await readFile(assetPath);
    if (sha256(bytes) !== artifacts[name].sha256) failures.push(`${name} differs from the runtime build`);
  }
  if (await exists(legacyAssetPath)) failures.push("obsolete PokewebPwanW2.dll is still bundled");
  if (!(await exists(manifestPath)) || (await readFile(manifestPath, "utf8")) !== manifestText) {
    failures.push("pwan-runtime-manifest.json is stale");
  }
  if (failures.length > 0) throw new Error(`PWAN runtime asset check failed:\n- ${failures.join("\n- ")}`);
  console.log(`Verified ${artifactNames.length} PWAN runtime artifacts.`);
  process.exit(0);
}

await mkdir(assetDir, { recursive: true });
for (const name of artifactNames) await copyFile(resolve(buildDir, name), resolve(assetDir, name));
await rm(legacyAssetPath, { force: true });
await writeFile(manifestPath, manifestText);
console.log(`Synchronized ${artifactNames.length} PWAN runtime artifacts.`);
