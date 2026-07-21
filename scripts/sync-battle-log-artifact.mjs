import { createHash } from "node:crypto";
import { copyFile, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, "..");
const checkOnly = process.argv.includes("--check");
const artifacts = [
  {
    name: "White2UpgradeBattleLog.dll",
    source: resolve(
      process.env.BATTLE_LOG_BUILD_PATH ??
        resolve(root, "../../White2Upgrade-Original-pokeweb/build/src/w2u_battle_log.dll"),
    ),
  },
  {
    name: "Black2UpgradeBattleLog.dll",
    source: resolve(
      process.env.BLACK2_BATTLE_LOG_BUILD_PATH ??
        resolve(root, "../../White2Upgrade-Original-pokeweb/build/src/Black2UpgradeBattleLog.dll"),
    ),
  },
];
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

if (checkOnly) {
  for (const artifact of artifacts) {
    const sourceBytes = await readFile(artifact.source);
    const destinationBytes = await readFile(resolve(root, "src/assets/codeinjection", artifact.name));
    if (hash(sourceBytes) !== hash(destinationBytes)) {
      throw new Error(`The bundled ${artifact.name} differs from the runtime build.`);
    }
  }
  console.log(`Verified ${artifacts.length} battle-log DLLs.`);
  process.exit(0);
}

for (const artifact of artifacts) {
  const sourceBytes = await readFile(artifact.source);
  if (sourceBytes.subarray(0, 4).toString("ascii") !== "DLXF") {
    throw new Error(`${artifact.source} is not a DLXF battle-log runtime.`);
  }
  await copyFile(artifact.source, resolve(root, "src/assets/codeinjection", artifact.name));
  console.log(`Synchronized ${artifact.name} (${sourceBytes.length} bytes).`);
}
