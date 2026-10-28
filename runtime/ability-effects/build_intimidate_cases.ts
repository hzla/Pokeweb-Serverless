/** Copied Intimidate stat selector: production export/reload and native fixtures. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NintendoDSRom } from "../../src/nds/rom";
import { readU16 } from "../../src/nds/binary";
import { battleRuntimeResolver } from "../../src/pokeweb/battleRuntimeBindings";
import { loadProjectFromRomBytes } from "../../src/pokeweb/loader";
import { configureAbilityRuleSets, inspectAbilityEffects, hydrateAbilityEffectsSource, ABILITY_EFFECTS_DLL_PATH, ABILITY_RULE_API } from "../../src/pokeweb/abilityEffectsModel";
import { validateAbilityRule, encodeAbilityRules, type AbilityRuleSet } from "../../src/pokeweb/abilityRules";
import { configureHarnessRuntime, parseHarnessConfig, patchHarnessSave, patchHarnessTrainer, validateHarnessRom } from "../../src/pokeweb/battleHarness";
import { exportModifiedRom } from "../../src/pokeweb/exportRom";
import { createProjectDocument } from "../../src/pokeweb/projectDocument";
import { openProjectSession } from "../../src/pokeweb/projectSession";
import { parseRpm } from "../../src/pokeweb/rpm";
import { prepareBw2TestBattleCodeInjection, stageCodeInjectionDll } from "../../src/pokeweb/pmcModel";
import { getTestBattleConfig, rawSaveBytesFromDesmumeDsv } from "../../src/pokeweb/testBattle";
import { decryptPk5Party } from "../../src/pokeweb/testBattleTeam";
import { updatePokemonField, getPokemonSummaryRecord } from "../../src/pokeweb/pokemonModel";

const [path, directory] = process.argv.slice(2);
if (!directory) throw new Error("Usage: ROM.nds OUTPUT_DIRECTORY");
const out = resolve(directory), input = new Uint8Array(await readFile(path));
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex"), inputHash = sha(input);
await mkdir(`${out}/saves`, { recursive: true });
globalThis.fetch = (async (request: RequestInfo | URL) => {
  const url = new URL(request instanceof Request ? request.url : String(request));
  if (url.protocol !== "file:") throw new Error("Only local bundled assets permitted.");
  return new Response(new Uint8Array(await readFile(url)));
}) as typeof fetch;
const load = (b: Uint8Array) => loadProjectFromRomBytes(b, "scare-validation.nds", { selectedNarcs: ["personal", "items", "message_texts", "moves", "trdata", "trpok"] });
let project = await load(input);
const entries = new Map<number, AbilityRuleSet>();
for (const [i, stat] of [3, 1, 2, 4, 5, 6, 7].entries()) entries.set(165 + i, validateAbilityRule({ effects: [{ kind: "nativeAbility:22", value: -1, stat }], conditions: { kind: "group", mode: "all", children: [] } }));
await configureAbilityRuleSets(project, [...entries].map(([abilityId, rules]) => ({ abilityId, rules, name: abilityId === 165 ? "Scare" : `Intimidate ${rules.effects[0].stat}` })));
updatePokemonField(project, 1, "personal", "ability_3", "Scare");
const verify = () => {
  const state = inspectAbilityEffects(project); assert(state.editable, state.message); assert.deepEqual(state.rules, entries);
  assert.equal(project.texts.banks.abilities?.[165], "Scare"); assert.equal(getPokemonSummaryRecord(project, 1).rawPersonal.ability_3, 165);
};
verify(); project = openProjectSession(createProjectDocument(project, false)); project.originalRomBytes = input;
hydrateAbilityEffectsSource(project, new NintendoDSRom(input, { fileData: "view" })); verify();
for (const [name, store] of Object.entries(project.narcs)) if (!store?.dirty.size) delete project.narcs[name as keyof typeof project.narcs];
const exported = await exportModifiedRom(project, { forDsi: false });
await writeFile(`${out}/scare.nds`, exported, { flag: "wx" }); project = await load(exported); verify();
// Re-export a reloaded ROM to verify that the edited callback remains editable.
await configureAbilityRuleSets(project, [{ abilityId: 165, name: "Scare", rules: entries.get(165)! }]);
for (const [name, store] of Object.entries(project.narcs)) if (!store?.dirty.size) delete project.narcs[name as keyof typeof project.narcs];
const reexported = await exportModifiedRom(project, { forDsi: false });
await writeFile(`${out}/scare-reloaded.nds`, reexported, { flag: "wx" }); project = await load(reexported); verify();
const rom = new NintendoDSRom(reexported, { fileData: "view" }); validateHarnessRom(rom);
const dll = parseRpm(rom.files[rom.fileId(ABILITY_EFFECTS_DLL_PATH)], { allowedMagics: ["DLXF"] });
const symbols = Object.fromEntries(dll.symbols.filter(s => s.name?.startsWith("Ability")).map(s => [s.name!, s.address]));
const api = Object.fromEntries(ABILITY_RULE_API.flatMap((name, i) => name ? [[name, new DataView(dll.code.buffer).getUint32(symbols.AbilityRuleApi + i * 4, true) & ~1]] : []));
const pmc = parseRpm(rom.files[rom.fileId("codeinjection/RPMSYM-PMC.rpm")]);
const pmcSymbols = Object.fromEntries(pmc.symbols.filter(s => s.name && /g_Modules|g_MainAllocator|g_UserHeapArea/u.test(s.name)).map(s => [s.name!, pmc.baseAddress + 32 + s.address]));
const overlay = rom.loadArm9Overlays([167]).get(167)!;
const nameLoader = battleRuntimeResolver(overlay.data, overlay.ramAddress, project.arm9, rom.arm9RamAddress).resolve("loadAbilityNameToStrbuf").address;
const encoded = encodeAbilityRules(entries), nativeOffsets: number[] = [];
for (const id of entries.keys()) { const at = readU16(encoded, id * 2); nativeOffsets.push(at + 4 + encoded[at + 1] * 4); }
const neutral = [6, 6, 6, 6, 6, 6, 6], stages = (stat: number, value = 5) => neutral.map((n, i) => i === stat - 1 ? value : n);
type Case = { label: string; abilityId: number; enemyAbility?: number; enemyMove?: number; doubles?: boolean; checks: Record<string, unknown> };
const cases: Case[] = [...entries].map(([abilityId, rules]) => ({ label: abilityId === 165 ? "scare-sp-atk" : `copied-stat-${rules.effects[0].stat}`, abilityId, checks: { stages: neutral, enemyStages: stages(rules.effects[0].stat!), ...(abilityId === 165 ? { name: true } : {}) } }));
cases.push(
  { label: "original-intimidate-unchanged", abilityId: 22, checks: { stages: neutral, enemyStages: stages(1) } },
  { label: "clear-body-blocks-scare", abilityId: 165, enemyAbility: 29, checks: { stages: neutral, enemyStages: neutral } },
  { label: "white-smoke-blocks-scare", abilityId: 165, enemyAbility: 73, checks: { stages: neutral, enemyStages: neutral } },
  { label: "hyper-cutter-allows-sp-atk-drop", abilityId: 165, enemyAbility: 52, checks: { stages: neutral, enemyStages: stages(3) } },
  { label: "contrary-reverses-scare", abilityId: 165, enemyAbility: 126, checks: { stages: neutral, enemyStages: stages(3, 7) } },
  { label: "simple-doubles-drop", abilityId: 165, enemyAbility: 86, checks: { stages: neutral, enemyStages: stages(3, 4) } },
  { label: "defiant-reacts-to-scare", abilityId: 165, enemyAbility: 128, checks: { stages: neutral, enemyStages: [8, 6, 5, 6, 6, 6, 6] } },
  { label: "scare-doubles-two-opponents", abilityId: 165, doubles: true, checks: { stages: neutral, enemyStages: stages(3), partyStages: [neutral, neutral], enemyPartyStages: [stages(3), stages(3)] } },
  { label: "scare-skill-swap-reactivates", abilityId: 165, enemyMove: 285, checks: { playerAbilities: [165, 50, 165], enemyAbilities: [50, 165, 50], playerStagesByTurn: [neutral, stages(3), stages(3)], enemyStagesByTurn: [stages(3), stages(3), stages(3, 4)] } },
);
const baseSave = rawSaveBytesFromDesmumeDsv(new Uint8Array(await readFile(getTestBattleConfig("BW2").saveUrl)));
await prepareBw2TestBattleCodeInjection(project);
const hashes: Record<string, string> = {}, fixtures: unknown[] = [];
for (const [i, spec] of cases.entries()) {
  const battleType = spec.doubles ? "Doubles" : "Singles", count = spec.doubles ? 2 : 1;
  const rule = patchHarnessTrainer(project, parseHarnessConfig({ trainerId: 2, battleType, trainer: { team: Array.from({ length: count }, () => ({ speciesId: 320, level: 100, moves: [spec.enemyMove ?? 150], itemId: 0, abilityId: spec.enemyAbility ?? 50 })), ai: 0 } }));
  stageCodeInjectionDll(project, "BattleHarnessW2.dll", configureHarnessRuntime(new Uint8Array(await readFile(new URL("../../src/assets/testbattle/BattleHarnessW2.dll", import.meta.url))), 2, rule));
  const save = patchHarnessSave(baseSave, project, parseHarnessConfig({ trainerId: 2, battleType, player: { team: Array.from({ length: count }, (_, n) => ({ speciesId: n ? 4 : 1, level: 50, moves: [150], itemId: 0, abilityId: n ? 50 : spec.abilityId })) } }));
  const raw = decryptPk5Party(save.subarray(0x18e08, 0x18e08 + 220)), maxHp = readU16(raw, 0x90);
  const label = `${String(i).padStart(3, "0")}-${spec.label}`, filename = `battle-${battleType}-${spec.enemyMove ?? 150}-${spec.enemyAbility ?? 50}.nds`;
  await writeFile(`${out}/saves/${label}.sav`, save, { flag: "wx" });
  if (!hashes[filename]) {
    const keep = project.narcs; project.narcs = Object.fromEntries(Object.entries(keep).filter(([name, store]) => ["personal", "trdata", "trpok"].includes(name) && store?.dirty.size));
    const bytes = await exportModifiedRom(project, { forDsi: false }); project.narcs = keep;
    await writeFile(`${out}/${filename}`, bytes, { flag: "wx" }); hashes[filename] = sha(bytes);
  }
  fixtures.push({ ...spec, label, rom: filename, speciesId: 1, hp: maxHp, maxHp });
}
await writeFile(`${out}/cases.json`, JSON.stringify({ inputSha256: inputHash, exportSha256: sha(exported), reexportSha256: sha(reexported), editedAbilities: entries.size, codeBytes: dll.code.length, bssBytes: dll.bssSize, serializedBytes: rom.files[rom.fileId(ABILITY_EFFECTS_DLL_PATH)].length, nameLoader, api, symbols, pmcSymbols, hook: dll.relocations.find(r => r.target.module === "167")!.target.address, configHex: Buffer.from(encoded).toString("hex"), nativeOffsets, romHashes: hashes, cases: fixtures, projectReload: true, romExportReload: true, reexportReload: true, assignmentByName: true }, null, 2) + "\n");
assert.equal(sha(new Uint8Array(await readFile(path))), inputHash);
console.log(`Scare and all seven stat choices survived project reopen, export/reload, edit/re-export/reload; ${cases.length} native fixtures prepared.`);
