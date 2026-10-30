/** Bind the Black 2 category smoke tests to the actual ROMs and observations. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NintendoDSRom } from "../../src/nds/rom";
import { loadProjectFromRomBytes } from "../../src/pokeweb/loader";
import { inspectItemEffect } from "../../src/pokeweb/itemEffectsModel";
import { detectSpecifyTrainerNaturesPatch } from "../../src/pokeweb/romPatchModel";

const [directory, inputPath] = process.argv.slice(2);
if (!inputPath) throw new Error("Usage: EVIDENCE_DIRECTORY ORIGINAL_BLACK2.nds");
const out = resolve(directory), sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const manifest = JSON.parse(await readFile(`${out}/battles/cases.json`, "utf8"));
const clients = JSON.parse(await readFile(`${out}/battles/client-cases.json`, "utf8"));
const direct = JSON.parse(await readFile(`${out}/direct/report.json`, "utf8"));
assert.equal(manifest.version, "B2"); assert(manifest.projectReload && manifest.romExportReload && manifest.trainerNatureMigrated);
assert.equal(sha(await readFile(inputPath)), manifest.inputSha256);
assert.equal(direct.inputSha256, manifest.inputSha256);
assert.equal(direct.recognizedSlots, 171); assert.deepEqual(direct.unavailable, []);
assert(direct.assignmentExportReload && direct.parametersExportReload && direct.typedHealingExportReload && direct.typedHealingRemovalExportReload && direct.trainerNatureMigrated && direct.inputUnchanged);
const bytes = new Uint8Array(await readFile(`${out}/battles/items.nds`));
assert.equal(sha(bytes), manifest.exportSha256);
const rom = new NintendoDSRom(bytes, { fileData: "view" }); assert.equal(rom.idCode, "IREO");
assert.equal(rom.filenames.idOf("patches/BattleHarnessB2.dll"), undefined);
const project = await loadProjectFromRomBytes(bytes, "item-smoke.nds", { selectedNarcs: ["items"] });
assert.equal(detectSpecifyTrainerNaturesPatch(project), "patched");
assert.equal(inspectItemEffect(project, 234).controls[0].value, 8);
assert.equal(inspectItemEffect(project, 220).controls[0].value, 1.75);
assert.equal(inspectItemEffect(project, 238).profileId, 234);
const artifacts: Record<string, string> = {};
async function artifact(path: string, expected?: string) {
  const digest = sha(await readFile(`${out}/${path}`));
  if (expected) assert.equal(digest, expected, path);
  artifacts[path] = digest; return digest;
}
await artifact("battles/items.nds", manifest.exportSha256);
for (const [name, hash] of Object.entries(manifest.romHashes)) await artifact(`battles/${name}`, String(hash));
const cases = [];
for (const spec of manifest.cases) {
  if (spec.rules) assert.deepEqual(inspectItemEffect(project, spec.itemId).rules, spec.rules);
  const result = JSON.parse(await readFile(`${out}/battles/${spec.label}-result.json`, "utf8"));
  assert(result.passed, spec.label); assert.equal(result.case, spec.label); assert.equal(result.itemId, spec.itemId);
  assert.equal(result.romSha256, manifest.romHashes[spec.rom]); assert.equal(result.menus.length, 3);
  assert.equal(result.loader.itemPatchRecords, 1); assert.equal(result.loader.liveRuleCount, manifest.editedItems);
  for (const name of ["bookkeeping", "system"]) assert(result.minimumObservedFree[name].freePayloadBytes > 0);
  await artifact(`battles/saves/${spec.label}.sav`, spec.saveSha256);
  await artifact(`battles/${spec.label}-result.json`); await artifact(`battles/${spec.label}.png`);
  cases.push({ label: spec.label, itemId: spec.itemId, hp: result.menus.map((m: { hp: number }) => m.hp), item: result.menus.map((m: { item: number }) => m.item), minimumObservedFree: result.minimumObservedFree });
}
for (const spec of clients.cases) {
  const result = JSON.parse(await readFile(`${out}/battles/${spec.label}-result.json`, "utf8"));
  assert(result.passed && result.queries.length >= 2); assert.equal(result.romSha256, spec.sha256);
  assert(result.queries.every((q: { result: number; restoredItem: number }) => q.result === spec.expected && q.restoredItem === spec.itemId));
  await artifact(`battles/${spec.label}.nds`, spec.sha256); await artifact(`battles/${spec.label}.sav`, spec.saveSha256);
  await artifact(`battles/${spec.label}-result.json`); await artifact(`battles/${spec.label}.png`);
}
await artifact("item-ui.png");
const tests = await readFile(`${out}/tests.log`, "utf8"), build = await readFile(`${out}/build-production.log`, "utf8");
const testCount = tests.match(/Tests\s+(\d+) passed \((\d+)\)/u);
assert(testCount && Number(testCount[1]) > 0 && testCount[1] === testCount[2]);
assert(/Test Files\s+4 passed \(4\)/u.test(tests)); assert(build.includes("built in"));
const sources = ["src/pokeweb/itemEffectsModel.ts", "src/pokeweb/itemRules.ts", "src/pokeweb/itemRuleRuntime.ts", "src/pokeweb/itemNativeRuntime.ts", "src/pokeweb/romPatchModel.ts", "src/pokeweb/trainerNaturePatch.ts", "src/assets/data/itemRuleRuntime.json", "src/assets/data/itemNativeBindings.json", "src/assets/data/itemEffectProfiles.json", "runtime/item-effects/build_compatibility_cases.ts", "runtime/item-effects/emulator_primitives.py", "runtime/item-effects/emulator_clients.py", "runtime/item-effects/verify_compatibility.ts", "runtime/ability-effects/compatibility_harness.ts", "scripts/verify-item-effects.ts"];
const sourceSha256 = Object.fromEntries(await Promise.all(sources.map(async path => [path, sha(await readFile(path))])));
const summary = { inputSha256: manifest.inputSha256, exportSha256: manifest.exportSha256, recognizedNativeProfiles: 171, nativeBattles: cases.length + clients.cases.length, completedTurns: (cases.length + clients.cases.length) * 2, customItems: manifest.editedItems, directEditedItems: manifest.directEditedItems, itemDlls: 1, codeBytes: manifest.codeBytes, bssBytes: manifest.bssBytes, serializedBytes: manifest.serializedBytes, trainerNatureMigrated: true, projectReopen: true, romExportReload: true, automatedTests: Number(testCount[1]), productionBuild: true, originalUnchanged: true, cases, clientCases: clients.cases.map((c: { label: string; expected: number }) => ({ label: c.label, expectedResult: c.expected })), sourceSha256, artifactSha256: artifacts, scope: "Representative DS-mode melonDS battles; normal keypad input and read-only hooks. No game-service stubs, injected calls, battle-RAM writes, hardware/DSi claims or exhaustive item-combination claim." };
await writeFile(`${out}/summary.json`, JSON.stringify(summary, null, 2) + "\n");
console.log(`${summary.nativeBattles} Black 2 battles / ${summary.completedTurns} turns, project/export/reload, 171 profiles and ${summary.automatedTests} automated tests passed; input unchanged.`);
