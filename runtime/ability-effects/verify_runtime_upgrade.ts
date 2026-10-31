/** Verify one-click migration with an explicit old ROM, preserving user data. */
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { loadProjectFromRomBytes } from "../../src/pokeweb/loader";
import { inspectAbilityEffects, upgradeAbilityRuntime, ABILITY_EFFECTS_DLL_PATH } from "../../src/pokeweb/abilityEffectsModel";
import { exportModifiedRom } from "../../src/pokeweb/exportRom";
import { NintendoDSRom } from "../../src/nds/rom";
import { parseRpm } from "../../src/pokeweb/rpm";

const [inputPath, outputPath, benchmarkDirectory] = process.argv.slice(2);
assert(outputPath, "Usage: OLD_ROM.nds NEW_OUTPUT_DIRECTORY [BEFORE_BENCHMARK_DIRECTORY]");
const out = resolve(outputPath); await mkdir(out); await mkdir(`${out}/saves`);
globalThis.fetch = (async request => {
  const url = new URL(request instanceof Request ? request.url : String(request)); assert.equal(url.protocol, "file:");
  return new Response(new Uint8Array(await readFile(url)));
}) as typeof fetch;
const hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const input = new Uint8Array(await readFile(inputPath));
const load = (b: Uint8Array) => loadProjectFromRomBytes(b, "ability-runtime-migration.nds", { selectedNarcs: ["personal", "items", "message_texts", "moves", "trdata", "trpok"] });
let project = await load(input);
const before = inspectAbilityEffects(project); assert(before.editable, before.message); assert.equal(before.runtimeVersion, 1);
const names = structuredClone(project.texts.banks.abilities), preserved = Object.values(project.narcs).filter(s => s && s.fileId >= 0).map(s => s!.sourcePath);
const original = new NintendoDSRom(input, { fileData: "view" });
assert(await upgradeAbilityRuntime(project));
const state = inspectAbilityEffects(project); assert(state.editable, state.message); assert.equal(state.runtimeVersion, 2); assert.deepEqual(state.rules, before.rules); assert.deepEqual(project.texts.banks.abilities, names);
assert.equal(await upgradeAbilityRuntime(project), false, "Migration must be idempotent");
for (const [name, store] of Object.entries(project.narcs)) if (!store?.dirty.size) delete project.narcs[name as keyof typeof project.narcs];
const output = await exportModifiedRom(project, { forDsi: false });
const rom = new NintendoDSRom(output, { fileData: "view" });
for (const path of preserved) assert.deepEqual(rom.getFileByName(path), original.getFileByName(path), `${path}: migration changed user data`);
project = await load(output); const reloaded = inspectAbilityEffects(project);
assert(reloaded.editable, reloaded.message); assert.equal(reloaded.runtimeVersion, 2); assert.deepEqual(reloaded.rules, before.rules); assert.deepEqual(project.texts.banks.abilities, names);
await writeFile(`${out}/migrated.nds`, output, { flag: "wx" });
if (benchmarkDirectory) {
  const old = JSON.parse(await readFile(`${benchmarkDirectory}/performance.json`, "utf8")), source = old.cases.find((c: { label: string }) => c.label === "80-passive"); assert(source);
  const rpm = parseRpm(rom.getFileByName(ABILITY_EFFECTS_DLL_PATH), { allowedMagics: ["DLXF"] });
  const label = "migrated-80-passive", spec = { ...source, label, rom: "migrated.nds", sha256: hash(output), codeBytes: rpm.code.length, bssBytes: rpm.bssSize,
    symbols: Object.fromEntries(rpm.symbols.filter(s => s.name?.startsWith("Ability")).map(s => [s.name!, s.address])) };
  await copyFile(`${benchmarkDirectory}/saves/80-passive.sav`, `${out}/saves/${label}.sav`);
  await writeFile(`${out}/performance.json`, JSON.stringify({ ...old, cases: [spec] }, null, 2) + "\n");
}
assert.equal(hash(new Uint8Array(await readFile(inputPath))), hash(input));
await writeFile(`${out}/migration.json`, JSON.stringify({ inputSha256: hash(input), outputSha256: hash(output), rules: before.rules.size, namesPreserved: true, archivesPreserved: preserved, runtimeVersion: 2, exportReload: true, idempotent: true }, null, 2) + "\n");
console.log(`Migrated ${before.rules.size} recipes; names, assignments and data archives preserved through export/reload.`);
