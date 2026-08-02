import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getTestBattleConfig, patchTestBattleSaveMoveAnimations } from "../src/pokeweb/testBattle";

const assetRoot = resolve(import.meta.dirname, "../src/assets/testbattle");
const saves = [
  ["white.dsv", "BW"],
  ["test.sav", "BW2"],
  ["White2Upgrade.dsv", "BW2"],
  ["Black2Upgrade.dsv", "BW2"],
] as const;

for (const [name, baseRom] of saves) {
  const path = resolve(assetRoot, name);
  const before = new Uint8Array(await readFile(path));
  const after = patchTestBattleSaveMoveAnimations(before, getTestBattleConfig(baseRom));
  await writeFile(path, after);
  console.log(`Enabled move animations in ${name}.`);
}
