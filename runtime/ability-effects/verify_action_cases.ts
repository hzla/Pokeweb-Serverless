/** Verify local action-recipe exports and native results; emit an ignored JSON receipt. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadProjectFromRomBytes } from "../../src/pokeweb/loader";
import { inspectAbilityEffects, ABILITY_EFFECTS_DLL_PATH } from "../../src/pokeweb/abilityEffectsModel";
import { encodeAbilityRules } from "../../src/pokeweb/abilityRules";
import { NintendoDSRom } from "../../src/nds/rom";
import { parseRpm } from "../../src/pokeweb/rpm";

const [directory, input] = process.argv.slice(2); assert(directory && input, "Usage: COHORT INPUT.nds");
const out = resolve(directory), sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const manifest = JSON.parse(await readFile(`${out}/cases.json`, "utf8"));
assert.equal(sha(await readFile(input)), manifest.inputSha256); assert(manifest.projectReload && manifest.romExportReload); assert.equal(manifest.reedits.length, 6);
globalThis.fetch = (async (request: RequestInfo | URL) => { const url = new URL(request instanceof Request ? request.url : String(request)); assert.equal(url.protocol, "file:"); return new Response(new Uint8Array(await readFile(url))); }) as typeof fetch;
for (const [file, expected] of [["ability-actions.nds", manifest.exportSha256], ["ability-actions-reloaded.nds", manifest.reexportSha256]]) {
  const bytes = new Uint8Array(await readFile(`${out}/${file}`)); assert.equal(sha(bytes), expected);
  const project = await loadProjectFromRomBytes(bytes, file, { selectedNarcs: ["personal", "items", "moves", "message_texts"] }), state = inspectAbilityEffects(project);
  assert(state.editable, state.message); assert.equal(state.rules.size, manifest.editedAbilities); assert.equal(Buffer.from(encodeAbilityRules(state.rules)).toString("hex"), manifest.configHex);
  for (const [id, name] of [[165, "High Pressure"], [166, "Blazing Glory"], [167, "Indignation"]] as const) assert.equal(project.texts.banks.abilities?.[id], name);
  const rom = new NintendoDSRom(bytes, { fileData: "view" }), dll = parseRpm(rom.files[rom.fileId(ABILITY_EFFECTS_DLL_PATH)], { allowedMagics: ["DLXF"] });
  assert.equal(dll.metadata.PokewebAbilityActions, 1); assert.equal(dll.bssSize, manifest.bssBytes); assert(dll.bssSize <= 16384); assert(dll.code.length + dll.bssSize <= 65536); assert(manifest.serializedBytes + dll.code.length + dll.bssSize <= 112 * 1024);
}
for (const [file, expected] of Object.entries(manifest.romHashes)) assert.equal(sha(await readFile(`${out}/${file}`)), expected);
const results = [], minimum: Record<string, number> = {}; let turns = 0;
for (const fixture of manifest.cases) {
  assert.equal(sha(await readFile(`${out}/saves/${fixture.label}.sav`)), fixture.saveSha256);
  const path = `${out}/${fixture.label}-result.json`, bytes = await readFile(path), result = JSON.parse(bytes.toString());
  assert(result.passed, fixture.label); assert.equal(result.romSha256, manifest.romHashes[fixture.rom]); assert.equal(result.loader.abilityPatchRecords, 1); assert.equal(result.loader.liveRuleCount, manifest.editedAbilities); assert.equal(result.menus.length, fixture.menuCount ?? 3);
  for (const [key, value] of Object.entries(result.minimumObservedFree) as Array<[string, { freePayloadBytes: number }]>) { assert(value.freePayloadBytes > 0); minimum[key] = Math.min(minimum[key] ?? Infinity, value.freePayloadBytes); }
  turns += result.menus.length - 1; results.push({ label: fixture.label, sha256: sha(bytes), passed: true });
}
assert.equal(results.length, 27);
const tests = await readFile(`${out}/tests.log`, "utf8"), types = await readFile(`${out}/types.log`, "utf8"), production = await readFile(`${out}/production.log`, "utf8");
assert(!types.trim()); assert(production.includes("built in")); const testCount = Number(tests.match(/Tests\s+(\d+) passed/u)?.[1]); assert(testCount >= 237 && !tests.includes(" failed"));
const older = execFileSync("git", ["ls-files", "src/assets/data/abilityRuleRuntime*.json"], { encoding: "utf8" }).trim().split("\n").filter(file => !file.endsWith("Actions.json"));
assert.equal(older.length, 14); for (const file of older) assert.equal(sha(await readFile(file)), sha(execFileSync("git", ["show", `HEAD:${file}`])), file);
const sources = ["runtime/ability-effects/actions.c", "runtime/ability-effects/recipes.c", "runtime/ability-effects/rules.c", "runtime/ability-effects/build.py", "runtime/ability-effects/emulator.py", "runtime/ability-effects/build_action_cases.ts", "src/pokeweb/abilityActionEffects.ts", "src/pokeweb/abilityRecipeEffects.ts", "src/pokeweb/abilityEffectsModel.ts", "src/pokeweb/abilityPrimitiveReference.ts", "src/ui/itemRuleEditor.ts", "src/test/abilityActions.test.ts", "src/assets/data/abilityRuleRuntimeRecipesActions.json", "src/assets/data/abilityRuleRuntimeClientActions.json"];
const sourceHashes = Object.fromEntries(await Promise.all(sources.map(async file => [file, sha(await readFile(file))])));
const summary = { nativeBattles: results.length, completedTurns: turns, automatedTests: testCount, editedAbilities: manifest.editedAbilities, oneSharedDll: true, codeBytes: manifest.codeBytes, bssBytes: manifest.bssBytes, serializedBytes: manifest.serializedBytes, minimumObservedFree: minimum, parameterRoundTrips: manifest.reedits.length, olderTemplatesUnchanged: older.length, inputUnchanged: true };
await writeFile(`${out}/receipt.json`, JSON.stringify({ summary, sourceHashes, results, romHashes: manifest.romHashes }, null, 2) + "\n"); console.log(JSON.stringify(summary, null, 2));
