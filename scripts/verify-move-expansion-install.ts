import fs from "node:fs";
import { exportModifiedRom } from "../src/pokeweb/exportRom";
import { loadProjectFromRomBytes } from "../src/pokeweb/loader";
import {
  MOVE_EXPANSION_TARGET_COUNT,
  detectMoveExpansionPatch,
  installMoveExpansion,
  parseMoveExpansionAnimationBundle,
} from "../src/pokeweb/moveExpansionPatch";
import { decompileMoveAnimationBytes, parseMoveAnimationScript } from "../src/pokeweb/moveAnimationModel";
import { commitTextBank, getTextBank, parseTextEntryId } from "../src/pokeweb/textModel";

const args = process.argv.slice(2);
const includeBundledAnimations = args.includes("--include-bundled-animations") || args.includes("--include-gen6-animations");
const path = args.find((arg) => !arg.startsWith("--"));
if (!path) throw new Error("Usage: npm run moveexpansion:verify-rom -- /path/to/clean-rom.nds [--include-bundled-animations]");

const source = new Uint8Array(fs.readFileSync(path));
const animationBundleBytes = includeBundledAnimations
  ? new Uint8Array(fs.readFileSync(new URL("../src/assets/data/white2upgradeGen6MoveAnimations.zip", import.meta.url)))
  : undefined;
const animationBundle = animationBundleBytes ? parseMoveExpansionAnimationBundle(animationBundleBytes) : undefined;
const project = await loadProjectFromRomBytes(source, path.split("/").pop() ?? "clean.nds");
const installed = await installMoveExpansion(project, { includeBundledAnimations, animationBundleBytes });
const exported = await exportModifiedRom(project);
const reloaded = await loadProjectFromRomBytes(exported, "move-expansion-verify.nds");

assert(reloaded.narcs.moves?.rawFiles.length === MOVE_EXPANSION_TARGET_COUNT, "move data count");
assert(reloaded.narcs.move_animations?.rawFiles.length === MOVE_EXPANSION_TARGET_COUNT, "move animation count");
assert(reloaded.texts.banks.moves?.length === MOVE_EXPANSION_TARGET_COUNT, "move name count");
assert(reloaded.texts.banks.moves?.[680] === "Flying Press", "first imported move name");
assert(reloaded.texts.banks.moves?.[984] === "Malignant Chain", "last imported move name");
assert(reloaded.narcs.moves?.rawFiles[680]?.[3] === 80, "Flying Press base power");
assert(reloaded.narcs.moves?.rawFiles[680]?.[4] === 95, "Flying Press accuracy");
assert(reloaded.narcs.moves?.rawFiles[680]?.[16] === 0 && reloaded.narcs.moves?.rawFiles[680]?.[17] === 0, "safe generic AI sequence");
assert(detectMoveExpansionPatch(reloaded) === "patched", "routing hook detection");
if (includeBundledAnimations) {
  assert(installed.bundledAnimationsInstalled === 128, "Gen 6-7 animation install count");
  assert(installed.particleFilesInstalled > 0, "Gen 6-7 particle install count");
  assert(reloaded.narcs.move_spas, "move particle archive loaded");
  for (const { targetMoveId: moveId } of animationBundle?.moves ?? []) {
    const bytes = reloaded.narcs.move_animations?.rawFiles[moveId];
    assert(bytes, `bundled animation ${moveId}`);
    const parsed = parseMoveAnimationScript(decompileMoveAnimationBytes(bytes));
    for (const command of [...parsed.scripts.values()].flat()) {
      if (!isParticleCommand(command.name)) continue;
      const particleId = command.params[0] ?? -1;
      assert(reloaded.narcs.move_spas.rawFiles[particleId], `move ${moveId} particle dependency ${particleId}`);
    }
  }
  assert(!decompileMoveAnimationBytes(reloaded.narcs.move_animations!.rawFiles[684]).includes("LoadSPA 770"), "relocated Mat Block particle reference");
}
const repeated = await installMoveExpansion(reloaded, { includeBundledAnimations, animationBundleBytes });
assert(!repeated.changed, "idempotent reinstall");

// Simulate an untouched Pound clone from Frost's data-expansion button and
// verify that Pokeweb upgrades it without replacing arbitrary custom slots.
const nameBankId = reloaded.session.baseRom === "BW2" ? 403 : 203;
reloaded.narcs.moves!.rawFiles[680] = reloaded.narcs.moves!.rawFiles[1].slice();
reloaded.narcs.move_animations!.rawFiles[680] = reloaded.narcs.move_animations!.rawFiles[1].slice();
const nameBank = getTextBank(reloaded, "message_texts", nameBankId);
const nameEntry = findTextEntry(nameBank, 680);
assert(nameEntry, "Frost placeholder name entry");
nameEntry[1] = "Pound";
const customNameEntry = findTextEntry(nameBank, 681);
assert(customNameEntry, "custom move name entry");
customNameEntry[1] = "Custom Move";
reloaded.narcs.moves.rawFiles[681] = reloaded.narcs.moves.rawFiles[1].slice();
reloaded.narcs.moves.rawFiles[681][3] = 123;
commitTextBank(reloaded, "message_texts", nameBankId);
const upgradedPlaceholder = await installMoveExpansion(reloaded);
assert(upgradedPlaceholder.importedMovesAdded === 1, "Frost Pound placeholder upgrade");
assert(reloaded.narcs.moves.rawFiles[680][3] === 80, "upgraded placeholder data");
assert(reloaded.texts.banks.moves?.[680] === "Flying Press", "upgraded placeholder name");
assert(reloaded.narcs.moves.rawFiles[681][3] === 123, "custom move data preservation");
assert(findTextEntry(getTextBank(reloaded, "message_texts", nameBankId), 681)?.[1] === "Custom Move", "custom move name preservation");

console.log(
  `Verified ${reloaded.session.baseVersion}: ${installed.importedMovesAdded} imported moves${includeBundledAnimations ? `, ${installed.bundledAnimationsInstalled} Gen 6-7 animations, ${installed.particleFilesInstalled} particle files` : ""}, ${exported.length} byte export, Frost routing signature present.`,
);

function isParticleCommand(name: string): boolean {
  return new Set([
    "LoadSPA",
    "DoSPAAnimation",
    "DoSPAScreenAnimation",
    "DoSPAAnimation2",
    "DoSPAAllAnimations",
    "DeleteSPA",
    "DoSPAProjectileAnimation",
    "DoSPAProjectileAnimation2",
    "DoSPAProjectileAnimation3",
    "DoSPAProjectileAnimationOrthoCoordinate",
    "DoSPACircleAnimation",
    "DoSPAOrthoCircleAnimation",
  ]).has(name);
}

function assert(value: unknown, label: string): asserts value {
  if (!value) throw new Error(`Move Expansion verification failed: ${label}`);
}

function findTextEntry(bank: ReturnType<typeof getTextBank>, entryIndex: number) {
  return bank.find((entry) => {
    const parsed = parseTextEntryId(entry[0]);
    return parsed.block === 0 && parsed.entry === entryIndex;
  });
}
