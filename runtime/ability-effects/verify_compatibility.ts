/** Bind successful BW2 template audits, exports and native battle observations. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NintendoDSRom } from "../../src/nds/rom";
import { loadProjectFromRomBytes } from "../../src/pokeweb/loader";
import { inspectAbilityEffects } from "../../src/pokeweb/abilityEffectsModel";
const directories = process.argv.slice(2);
if (directories.length !== 2) throw new Error("Usage: BLACK2_EVIDENCE WHITE2_EVIDENCE");
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const summaries = [];
for (const directory of directories) {
  const root = resolve(directory), manifest = JSON.parse(await readFile(`${root}/cases.json`, "utf8"));
  const audit = JSON.parse(await readFile(`${root}/templates.json`, "utf8"));
  assert.equal(audit.version, manifest.version); assert.equal(audit.inputSha256, manifest.inputSha256);
  assert.equal(audit.nativeTemplates + audit.imports, 226); assert.deepEqual(audit.failures, []);
  assert(manifest.projectReload && manifest.romExportReload && manifest.counterUnchanged);
  const counterName = `${manifest.version === "B2" ? "Black2Upgrade" : "White2Upgrade"}BattleCounters.dll`;
  const artifacts: Record<string, string> = {};
  for (const [name, digest] of Object.entries(manifest.romHashes)) {
    const bytes = new Uint8Array(await readFile(`${root}/${name}`)); assert.equal(sha(bytes), digest);
    const rom = new NintendoDSRom(bytes, { fileData: "view" });
    assert.equal(sha(rom.files[rom.fileId(`patches/${counterName}`)]), manifest.counterSha256);
    const project = await loadProjectFromRomBytes(bytes, "fixture.nds", { selectedNarcs: ["personal", "items", "message_texts"] });
    const abilities = inspectAbilityEffects(project);
    assert(abilities.editable, abilities.message); assert.equal(abilities.rules.size, 8);
    artifacts[name] = digest as string;
  }
  const cases = [];
  for (const spec of manifest.cases) {
    const resultBytes = await readFile(`${root}/${spec.label}-result.json`), result = JSON.parse(resultBytes.toString());
    assert(result.passed, spec.label); assert.equal(result.romSha256, manifest.romHashes[spec.rom]);
    assert.equal(result.case, spec.label); assert.equal(result.abilityId, spec.abilityId);
    assert.equal(result.menus.length, spec.menuCount ?? 3); assert.equal(result.loader.abilityPatchRecords, 1);
    assert.equal(sha(await readFile(`${root}/saves/${spec.label}.sav`)), spec.saveSha256);
    assert(result.counterCalls > 0, `Counter hook was not exercised: ${spec.label}`);
    if (spec.checks.counterImport) assert(result.abilityCounterCalls > 0);
    if (spec.checks.trapType !== undefined) assert(result.clientTraps.some((call: { result: number; ability: number; frame: number }) => call.result === 0 && call.ability === spec.enemyAbility && call.frame >= result.menus[0].frame + 120));
    artifacts[`${spec.label}-result.json`] = sha(resultBytes);
    artifacts[`${spec.label}.png`] = sha(await readFile(`${root}/${spec.label}.png`));
    cases.push({ label: spec.label, passed: true, frames: result.menus.map((state: { frame: number }) => state.frame), counterCalls: result.counterCalls, abilityCounterCalls: result.abilityCounterCalls });
  }
  const summary = { version: manifest.version, inputSha256: manifest.inputSha256, templates: 226, projectReopen: true, romExportReload: true, counterDllUnchanged: true, trainerNatureMigrated: manifest.trainerNatureMigrated ?? false, cases, completedTurns: manifest.cases.reduce((count: number, spec: { menuCount?: number }) => count + (spec.menuCount ?? 3) - 1, 0), artifactSha256: artifacts, scope: "DS-mode melonDS cold boots; normal keypad/touch input and read-only hooks; no game-service stubs or battle-state writes." };
  await writeFile(`${root}/summary.json`, JSON.stringify(summary, null, 2) + "\n"); summaries.push(summary);
}
assert.deepEqual(summaries.map(s => s.version).sort(), ["B2", "W2"]);
const sources = ["src/pokeweb/abilityEffectsModel.ts", "src/pokeweb/abilityNativeRuntime.ts", "src/pokeweb/battleLogModel.ts", "src/pokeweb/itemEffectsModel.ts", "src/pokeweb/battleRuntimeBindings.ts", "src/assets/data/abilityBindings.json", "src/assets/data/abilityClientBindings.json", "src/assets/data/abilityRuleRuntimeClient.json", "runtime/ability-effects/build.py", "runtime/ability-effects/rules.c", "runtime/ability-effects/client_traps.c", "runtime/ability-effects/generate_bindings.ts", "runtime/ability-effects/generate_client_bindings.ts", "runtime/ability-effects/compatibility_harness.ts", "runtime/ability-effects/build_compatibility_cases.ts", "runtime/ability-effects/emulator.py", "runtime/ability-effects/verify_compatibility.ts", "src/test/abilityPatchCompatibility.test.ts", "src/test/battleRuntimeBindings.test.ts"];
const sourceSha256 = Object.fromEntries(await Promise.all(sources.map(async path => [path, sha(await readFile(path))])));
const report = { sourceSha256, games: summaries };
await writeFile(`${resolve(directories[0])}/../compatibility-summary.json`, JSON.stringify(report, null, 2) + "\n");
console.log(`${summaries.reduce((n, s) => n + s.cases.length, 0)} native battle cases and 226 template builds per game passed.`);
