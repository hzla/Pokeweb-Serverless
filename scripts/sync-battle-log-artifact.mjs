import { createHash } from "node:crypto";
import { copyFile, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, "..");
const source = resolve(
  process.env.BATTLE_LOG_BUILD_PATH ??
    resolve(root, "../../White2Upgrade-Original-pokeweb/build/src/w2u_battle_log.dll"),
);
const destination = resolve(root, "src/assets/codeinjection/White2UpgradeBattleLog.dll");
const checkOnly = process.argv.includes("--check");

const sourceBytes = await readFile(source);
if (sourceBytes.subarray(0, 4).toString("ascii") !== "DLXF") {
  throw new Error(`${source} is not a DLXF battle-log runtime.`);
}

if (checkOnly) {
  const destinationBytes = await readFile(destination);
  const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
  if (hash(sourceBytes) !== hash(destinationBytes)) {
    throw new Error("The bundled White2UpgradeBattleLog.dll differs from the runtime build.");
  }
  console.log(`Verified White2UpgradeBattleLog.dll (${sourceBytes.length} bytes).`);
  process.exit(0);
}

await copyFile(source, destination);
console.log(`Synchronized White2UpgradeBattleLog.dll (${sourceBytes.length} bytes).`);
