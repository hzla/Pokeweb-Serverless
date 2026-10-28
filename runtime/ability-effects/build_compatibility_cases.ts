/** Audit all templates and prepare narrow BW2 counter/Fairy battle fixtures. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NintendoDSRom } from "../../src/nds/rom";
import { readU16 } from "../../src/nds/binary";
import { loadProjectFromRomBytes } from "../../src/pokeweb/loader";
import { ABILITY_RULE_PRESETS, encodeAbilityRules, validateAbilityRule, type AbilityRuleSet } from "../../src/pokeweb/abilityRules";
import { ABILITY_IMPORT_LIBRARY, abilityImport } from "../../src/pokeweb/abilityLibrary";
import { ABILITY_EFFECTS_DLL_PATH, ABILITY_RULE_API, buildAbilityRuleModule, configureAbilityRuleSets, inspectAbilityEffects } from "../../src/pokeweb/abilityEffectsModel";
import { battleRuntimeResolver } from "../../src/pokeweb/battleRuntimeBindings";
import { installBattleLog } from "../../src/pokeweb/battleLogModel";
import { prepareBw2TestBattleCodeInjection, stageCodeInjectionDll } from "../../src/pokeweb/pmcModel";
import { black2CompatibilityHarness } from "./compatibility_harness";
import { createProjectDocument } from "../../src/pokeweb/projectDocument";
import { openProjectSession } from "../../src/pokeweb/projectSession";
import { exportModifiedRom } from "../../src/pokeweb/exportRom";
import { parseRpm } from "../../src/pokeweb/rpm";
import { decodeRecord, markDirty, type ProjectState } from "../../src/pokeweb/projectStore";
import { buildTestBattleDownloads, rawSaveBytesFromDesmumeDsv } from "../../src/pokeweb/testBattle";
import { parseHarnessConfig, patchHarnessSave, patchHarnessTrainer } from "../../src/pokeweb/battleHarness";
import { decryptPk5Party } from "../../src/pokeweb/testBattleTeam";
import { detectSpecifyTrainerNaturesPatch } from "../../src/pokeweb/romPatchModel";

const [inputPath, directory, white2Reference] = process.argv.slice(2);
if (!directory) throw new Error("Usage: ROM.nds NEW_EVIDENCE_DIRECTORY");
const out = resolve(directory), input = new Uint8Array(await readFile(inputPath));
const sha = (data: Uint8Array) => createHash("sha256").update(data).digest("hex"), inputHash = sha(input);
await mkdir(`${out}/saves`, { recursive: true });
globalThis.fetch = (async (request: RequestInfo | URL) => {
  const url = new URL(request instanceof Request ? request.url : String(request));
  if (url.protocol !== "file:") throw new Error("Only local bundled assets permitted.");
  return new Response(new Uint8Array(await readFile(url)));
}) as typeof fetch;
const load = (bytes: Uint8Array) => loadProjectFromRomBytes(bytes, "ability-compatibility.nds", { selectedNarcs: ["personal", "items", "message_texts", "moves", "trdata", "trpok"] });
let project = await load(input);
const version = project.session.baseVersion;
assert(version === "B2" || version === "W2");
if (version === "B2" && !white2Reference) throw new Error("Black 2 fixtures require an explicit US White 2 reference ROM to check the test-only launcher port.");
const trainerId = version === "B2" ? 87 : 2;
const counterName = `${version === "B2" ? "Black2Upgrade" : "White2Upgrade"}BattleCounters.dll`;
const counter = new Uint8Array(await readFile(new URL(`../../src/assets/codeinjection/${counterName}`, import.meta.url)));
// Applying abilities migrates an installed legacy nature helper atomically.
const trainerNatureMigrated = detectSpecifyTrainerNaturesPatch(project) === "legacy";
await installBattleLog(project);
const failures = [];
for (const entry of [...ABILITY_RULE_PRESETS, ...ABILITY_IMPORT_LIBRARY]) {
  try { buildAbilityRuleModule(project, new Map([[165, entry.rule]])); }
  catch (error) { failures.push({ label: entry.label, error: String(error) }); }
}
await writeFile(`${out}/templates.json`, JSON.stringify({ version, inputSha256: inputHash, nativeTemplates: 157, imports: 69, failures }, null, 2) + "\n");
assert.equal(failures.length, 0, JSON.stringify(failures));
console.log(`${version}: all 226 templates build with the counter module.`);
const all = { kind: "group" as const, mode: "all" as const, children: [] };
const entries = new Map<number, AbilityRuleSet>([
  [165, validateAbilityRule({ effects: [{ kind: "healFlat", value: 7 }], conditions: all })],
  [166, validateAbilityRule({ effects: [{ kind: "nativeAbility:22", value: -1, stat: 3 }], conditions: all })],
  [167, validateAbilityRule({ effects: [{ kind: "attack", value: 2.5 }], conditions: all })],
  [168, validateAbilityRule({ ...abilityImport(234).rule, effects: [{ ...abilityImport(234).rule.effects[0], value: 2 }] })],
  [169, validateAbilityRule({ ...abilityImport(192).rule, effects: [{ ...abilityImport(192).rule.effects[0], value: 2 }] })],
  [170, validateAbilityRule({ effects: [{ kind: "nativeAbility:153", value: -1, parameters: { stat: 3, stages: 2 } }], conditions: all })],
  [171, validateAbilityRule(ABILITY_RULE_PRESETS.find(p => p.id === 16)!.rule)],
  [172, validateAbilityRule({ effects: [{ kind: "nativeAbility:42", value: -1, parameters: { trapType: 17 } }], conditions: all })],
]);
await configureAbilityRuleSets(project, [...entries].map(([abilityId, rules]) => ({ abilityId, rules, name: `Compat ${abilityId}` })));
if (trainerNatureMigrated) assert.equal(detectSpecifyTrainerNaturesPatch(project), "patched");
project = openProjectSession(createProjectDocument(project, false)); project.originalRomBytes = input;
assert.deepEqual(inspectAbilityEffects(project).rules, entries);
const exported = await exportModifiedRom(project, { forDsi: false });
await writeFile(`${out}/abilities.nds`, exported, { flag: "wx" });
project = await load(exported);
assert.deepEqual(inspectAbilityEffects(project).rules, entries);
const rom = new NintendoDSRom(exported, { fileData: "view" }), overlay = rom.loadArm9Overlays([167]).get(167)!;
assert.deepEqual(rom.files[rom.fileId(`patches/${counterName}`)], counter);
const dllBytes = rom.files[rom.fileId(ABILITY_EFFECTS_DLL_PATH)], dll = parseRpm(dllBytes, { allowedMagics: ["DLXF"] });
const symbols = Object.fromEntries(dll.symbols.filter(s => s.name?.startsWith("Ability")).map(s => [s.name!, s.address]));
// Check the compiled output stores before using read-only CPU probes. DTCM
// stack outputs cannot be read through melonDS's underlying bus-memory API.
const clientFunction = dll.symbols.find(s => s.name === "AbilityClientTrapped")!;
const clientCode = Buffer.from(dll.code.subarray(clientFunction.address, clientFunction.address + clientFunction.size));
const store = (hex: string, offset: number) => {
  const pattern = Buffer.from(hex, "hex"), at = clientCode.indexOf(pattern);
  assert(at >= 0 && clientCode.indexOf(pattern, at + 1) === -1, "Unrecognized client trapping output store");
  return clientFunction.address + at + offset;
};
const clientTrapStores = { trapper: store("08ab1b5d019a1370", 6), ability: store("029b002b00d01e800025", 6) };
const api = Object.fromEntries(ABILITY_RULE_API.flatMap((name, i) => name ? [[name, new DataView(dll.code.buffer).getUint32(symbols.AbilityRuleApi + i * 4, true) & ~1]] : []));
const pmc = parseRpm(rom.files[rom.fileId("codeinjection/RPMSYM-PMC.rpm")]);
const pmcSymbols = Object.fromEntries(pmc.symbols.filter(s => s.name && /g_Modules|g_MainAllocator|g_UserHeapArea/u.test(s.name)).map(s => [s.name!, pmc.baseAddress + 32 + s.address]));
const resolver = battleRuntimeResolver(overlay.data, overlay.ramAddress, project.arm9, rom.arm9RamAddress);
const encoded = encodeAbilityRules(entries), nativeOffsets: number[] = [];
for (const [id, rules] of entries) { const at = readU16(encoded, id * 2), start = at + 4 + encoded[at + 1] * 4; rules.effects.forEach((effect, i) => { if (effect.kind.startsWith("nativeAbility:")) nativeOffsets.push(start + i * 16); }); }
const neutral = [6, 6, 6, 6, 6, 6, 6];
const cases = [
  { label: "edited-healing", abilityId: 165, hp: 10, checks: { heal: 7 } },
  { label: "copied-intimidate", abilityId: 166, checks: { enemyStages: [6, 6, 5, 6, 6, 6, 6] } },
  { label: "edited-multiplier", abilityId: 167, move: 33, checks: { multiplier: 10240 } },
  { label: "edited-import-entry", abilityId: 168, checks: { stages: [8, 6, 6, 6, 6, 6, 6], counterPresent: true } },
  { label: "edited-import-reaction", abilityId: 169, enemyMove: 33, checks: { playerStagesByTurn: [neutral, [6, 8, 6, 6, 6, 6, 6], [6, 10, 6, 6, 6, 6, 6]] } },
  { label: "edited-moxie", abilityId: 170, move: 33, level: 100, enemyLevel: 1, enemyCount: 2, menuCount: 2, checks: { playerStagesFirstTurn: [6, 6, 8, 6, 6, 6, 6], counterImport: true } },
  { label: "fairy-color-change", abilityId: 171, enemyMove: 53, checks: { playerTypesAfterFirstTurn: [17, 17] } },
  { label: "fairy-magnet-pull", abilityId: 50, enemyAbility: 172, menuCount: 1, checks: { trapType: 17 } },
] as Array<{ label: string; abilityId: number; enemyAbility?: number; hp?: number; move?: number; level?: number; enemyMove?: number; enemyLevel?: number; enemyCount?: number; menuCount?: number; checks: Record<string, unknown> }>;
const hashes: Record<string, string> = {}, baseSaves: Record<string, Uint8Array> = {}, fixtures = [];
if (version === "B2") {
  const harness = await black2CompatibilityHarness(rom, white2Reference!, trainerId, 0);
  await prepareBw2TestBattleCodeInjection(project);
  stageCodeInjectionDll(project, "BattleHarnessB2.dll", harness.bytes);
  await writeFile(`${out}/harness-addresses.json`, JSON.stringify(harness.addresses, null, 2) + "\n");
}
// A known move makes the Fairy type-range path observable without importing moves.
decodeRecord(project, "moves", 53).raw!.type = 17; markDirty(project, "moves", 53);
for (const spec of cases) {
  const trapping = spec.enemyAbility === 172;
  const file = trapping ? "battle-fairy-trap.nds" : `battle-${spec.enemyMove ?? 150}-${spec.enemyLevel ?? (spec.enemyMove ? 5 : 100)}-${spec.enemyCount ?? 1}.nds`;
  if (!hashes[file]) {
    if (trapping) { const personal = decodeRecord(project, "personal", 1).raw!; personal.type_1 = 17; personal.type_2 = 17; markDirty(project, "personal", 1); }
    patchHarnessTrainer(project, parseHarnessConfig({ trainerId, battleType: "Singles", trainer: { ai: 0, team: Array.from({ length: spec.enemyCount ?? 1 }, () => ({ speciesId: 320, level: spec.enemyLevel ?? (spec.enemyMove || trapping ? 5 : 100), moves: [spec.enemyMove ?? 150], abilityId: spec.enemyAbility ?? 50, itemId: 0 })) } }));
    const battle = version === "B2" ? { romBytes: await exportModifiedRom(project, { forDsi: false }), saveBytes: new Uint8Array(await readFile(new URL("../../src/assets/testbattle/test.sav", import.meta.url))) }
      : await buildTestBattleDownloads(project, trainerId, { playerTeamText: "Bulbasaur\nLevel: 50\n- Splash" });
    await writeFile(`${out}/${file}`, battle.romBytes, { flag: "wx" });
    hashes[file] = sha(battle.romBytes); baseSaves[file] = rawSaveBytesFromDesmumeDsv(battle.saveBytes);
  }
  const save = patchHarnessSave(baseSaves[file], project, parseHarnessConfig({ trainerId, player: { team: [{ speciesId: 1, level: spec.level ?? 50, abilityId: spec.abilityId, moves: [spec.move ?? 150], itemId: 0, ...(spec.hp ? { currentHp: spec.hp } : {}) }, ...(spec.abilityId === 170 ? [] : [{ speciesId: 4, level: 50, abilityId: 50, moves: [150] }])] } }));
  const raw = decryptPk5Party(save.subarray(0x18e08, 0x18e08 + 220)), maxHp = readU16(raw, 0x90);
  await writeFile(`${out}/saves/${spec.label}.sav`, save, { flag: "wx" });
  fixtures.push({ ...spec, speciesId: 1, hp: spec.hp ?? maxHp, maxHp, rom: file, saveSha256: sha(save) });
}
const counterRpm = parseRpm(counter, { allowedMagics: ["DLXF"] });
const hook = counterRpm.relocations.find(r => r.target.type === "THUMB_BRANCH")!;
const counterSymbol = counterRpm.symbols[hook.sourceSymbolIndex];
await writeFile(`${out}/cases.json`, JSON.stringify({ version, manualLaunch: false, inputSha256: inputHash, exportSha256: sha(exported), counterSha256: sha(counter), counterHook: hook.target.address & ~1, counterPrefix: Buffer.from(counterRpm.code.subarray((counterSymbol.address - counterRpm.baseAddress) & ~1, ((counterSymbol.address - counterRpm.baseAddress) & ~1) + 8)).toString("hex"), typeQuery: resolver.resolve("DoesMonHaveType").address, openingHook: version === "B2" ? 0x0219f59a : 0x0219f5da, commandHook: version === "B2" ? 0x021ceed8 : 0x021cef18, editedAbilities: entries.size, codeBytes: dll.code.length, bssBytes: dll.bssSize, serializedBytes: dllBytes.length, api, symbols, clientTrapStores, pmcSymbols, hook: dll.relocations.find(r => r.target.module === "167")!.target.address, configHex: Buffer.from(encoded).toString("hex"), nativeOffsets, romHashes: hashes, cases: fixtures, projectReload: true, romExportReload: true, counterUnchanged: true, trainerNatureMigrated }, null, 2) + "\n");
assert.equal(sha(new Uint8Array(await readFile(inputPath))), inputHash);
console.log(`${version}: project/ROM reload passed; ${fixtures.length} battle fixtures prepared.`);
