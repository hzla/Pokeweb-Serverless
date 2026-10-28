/** Collect native evidence and prove a reloaded stat operand can be changed again. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { loadProjectFromRomBytes } from "../../src/pokeweb/loader";
import { configureAbilityRuleSets, inspectAbilityEffects } from "../../src/pokeweb/abilityEffectsModel";
import { exportModifiedRom } from "../../src/pokeweb/exportRom";
const [directory, previousExport, original] = process.argv.slice(2);
if (!directory) throw new Error("Usage: EVIDENCE_DIRECTORY [PREVIOUS_EXPORT.nds] [ORIGINAL.nds]");
globalThis.fetch = (async (request: RequestInfo | URL) => {
  const url = new URL(request instanceof Request ? request.url : String(request));
  if (url.protocol !== "file:") throw new Error("Only local bundled assets permitted.");
  return new Response(new Uint8Array(await readFile(url)));
}) as typeof fetch;
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const load = (b: Uint8Array) => loadProjectFromRomBytes(b, "scare-stat-edit.nds", { selectedNarcs: ["personal", "message_texts"] });
const manifest = JSON.parse(await readFile(`${directory}/cases.json`, "utf8"));
for (const [name, hash] of Object.entries(manifest.romHashes)) assert.equal(sha(await readFile(`${directory}/${name}`)), hash);
assert.equal(sha(await readFile(`${directory}/scare.nds`)), manifest.exportSha256);
assert.equal(sha(await readFile(`${directory}/scare-reloaded.nds`)), manifest.reexportSha256);
const results = await Promise.all(manifest.cases.map(async (spec: { label: string; rom: string; abilityId: number }) => {
  const r = JSON.parse(await readFile(`${directory}/${spec.label}-result.json`, "utf8"));
  assert(r.passed); assert.equal(r.romSha256, manifest.romHashes[spec.rom]); assert.equal(r.abilityId, spec.abilityId);
  assert.equal(r.loader.abilityPatchRecords, 1); assert.equal(r.loader.liveRuleCount, manifest.editedAbilities); assert.equal(r.menus.length, 3);
  return r;
}));
let project = await load(new Uint8Array(await readFile(`${directory}/scare-reloaded.nds`)));
const rules = inspectAbilityEffects(project).rules, scare = rules.get(165)!;
assert.equal(scare.effects[0].stat, 3);
const statEdits = [];
for (const stat of [4, 3]) {
  const rule = { ...scare, effects: [{ ...scare.effects[0], stat }] };
  await configureAbilityRuleSets(project, [{ abilityId: 165, name: "Scare", rules: rule }]);
  for (const [name, store] of Object.entries(project.narcs)) if (!store?.dirty.size) delete project.narcs[name as keyof typeof project.narcs];
  const bytes = await exportModifiedRom(project, { forDsi: false });
  const file = `scare-stat-${stat}-edited.nds`; await writeFile(`${directory}/${file}`, bytes, { flag: "wx" });
  project = await load(bytes); const state = inspectAbilityEffects(project); assert(state.editable, state.message);
  assert.equal(state.rules.get(165)!.effects[0].stat, stat); assert.equal(state.rules.size, rules.size);
  assert.equal(project.texts.banks.abilities?.[165], "Scare");
  for (const [id, other] of rules) if (id !== 165) assert.deepEqual(state.rules.get(id), other);
  statEdits.push({ stat, file, sha256: sha(bytes), editableAfterReload: true });
}
let previousRegistry;
if (previousExport) {
  const bytes = new Uint8Array(await readFile(previousExport)), state = inspectAbilityEffects(await load(bytes));
  assert(state.editable, state.message); assert.equal(state.rules.size, 100);
  previousRegistry = { sha256: sha(bytes), retainedRules: state.rules.size, canonicalModuleVerified: true };
}
if (original) assert.equal(sha(await readFile(original)), manifest.inputSha256);
const summary = {
  passed: results.length, completedTurns: results.length * 2, inputSha256: manifest.inputSha256,
  exportSha256: manifest.exportSha256, reexportSha256: manifest.reexportSha256,
  editedAbilities: manifest.editedAbilities, sharedAbilityDlls: 1,
  codeBytes: manifest.codeBytes, bssBytes: manifest.bssBytes, serializedBytes: manifest.serializedBytes,
  projectReopen: manifest.projectReload, romExportReload: manifest.romExportReload, assignmentByName: manifest.assignmentByName,
  reloadedStatEdits: statEdits, previousRegistry,
  minimumObservedFreePayload: Object.fromEntries(["bookkeeping", "system"].map(key => [key, Math.min(...results.map(r => r.minimumObservedFree[key].freePayloadBytes))])),
  cases: results.map(r => ({ label: r.case, abilityId: r.abilityId, passed: true })),
  scope: "DS-mode melonDS cold boots; normal keypad input; read-only hooks; no game-service stubs or battle-state writes.",
};
await writeFile(`${directory}/summary.json`, JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2));
