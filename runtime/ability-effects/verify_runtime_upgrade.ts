/** Verify one-click migration with an explicit old ROM, preserving user data. */
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { loadProjectFromRomBytes } from "../../src/pokeweb/loader";
import { CURRENT_ABILITY_RUNTIME_VERSION, inspectAbilityEffects, upgradeAbilityRuntime, ABILITY_EFFECTS_DLL_PATH } from "../../src/pokeweb/abilityEffectsModel";
import { exportModifiedRom } from "../../src/pokeweb/exportRom";
import { NintendoDSRom } from "../../src/nds/rom";
import { parseRpm } from "../../src/pokeweb/rpm";
import { NARC } from "../../src/nds/narc";
import { getTextBank } from "../../src/pokeweb/textModel";

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
const before = inspectAbilityEffects(project); assert(before.editable, before.message); assert(before.runtimeVersion !== undefined && before.runtimeVersion < CURRENT_ABILITY_RUNTIME_VERSION, "Expected a recognized older ability runtime");
const names = structuredClone(project.texts.banks.abilities), preserved = Object.values(project.narcs).filter(s => s && s.fileId >= 0).map(s => s!.sourcePath);
const original = new NintendoDSRom(input, { fileData: "view" });
const messagePath=project.narcs.message_texts!.sourcePath,battleBank=project.session.baseRom==="BW"?14:18;
const battleText=getTextBank(project,"message_texts",battleBank).map(entry=>entry.slice(0,2));
assert(await upgradeAbilityRuntime(project));
const state = inspectAbilityEffects(project); assert(state.editable, state.message); assert.equal(state.runtimeVersion, CURRENT_ABILITY_RUNTIME_VERSION); assert.deepEqual(state.rules, before.rules); assert.deepEqual(project.texts.banks.abilities, names);
assert.equal(await upgradeAbilityRuntime(project), false, "Migration must be idempotent");
for (const [name, store] of Object.entries(project.narcs)) if (!store?.dirty.size) delete project.narcs[name as keyof typeof project.narcs];
const output = await exportModifiedRom(project, { forDsi: false });
const rom = new NintendoDSRom(output, { fileData: "view" });
for (const path of preserved) {
  if(path!==messagePath)assert.deepEqual(rom.getFileByName(path), original.getFileByName(path), `${path}: migration changed user data`);
  else {const old=new NARC(original.getFileByName(path)),next=new NARC(rom.getFileByName(path));assert.equal(old.files.length,next.files.length);old.files.forEach((file,id)=>{if(id!==battleBank)assert.deepEqual(next.files[id],file,`Text bank ${id} changed`);});}
}
project = await load(output); const reloaded = inspectAbilityEffects(project);
assert(reloaded.editable, reloaded.message); assert.equal(reloaded.runtimeVersion, CURRENT_ABILITY_RUNTIME_VERSION); assert.deepEqual(reloaded.rules, before.rules); assert.deepEqual(project.texts.banks.abilities, names);
assert.deepEqual(getTextBank(project,"message_texts",battleBank).slice(0,battleText.length).map(entry=>entry.slice(0,2)),battleText,"Existing battle text changed");
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
await writeFile(`${out}/migration.json`, JSON.stringify({ inputSha256: hash(input), outputSha256: hash(output), rules: before.rules.size, namesPreserved: true, archivesPreserved: preserved, runtimeVersion: CURRENT_ABILITY_RUNTIME_VERSION, exportReload: true, idempotent: true }, null, 2) + "\n");
console.log(`Migrated ${before.rules.size} recipes; names, assignments and data archives preserved through export/reload.`);
